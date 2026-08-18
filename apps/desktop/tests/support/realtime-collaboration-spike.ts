import { Compartment, EditorSelection, EditorState, Prec, Transaction } from "@codemirror/state";
import {
  EditorView,
  ViewPlugin,
  keymap,
  runScopeHandlers,
  type ViewUpdate,
} from "@codemirror/view";
import { prosemarkBasicSetup } from "../../src/lib/prosemark-core/main";
import {
  Awareness,
  applyAwarenessUpdate,
  encodeAwarenessUpdate,
  removeAwarenessStates,
} from "y-protocols/awareness";
import { yCollab, ySyncAnnotation, ySyncFacet, yUndoManagerKeymap } from "y-codemirror.next";
import type { IndexeddbPersistence } from "y-indexeddb";
import * as Y from "yjs";

export type ProviderStatus = "offline" | "connecting" | "connected" | "error";

export interface SpikeProvider {
  readonly awareness: Awareness;
  readonly status: ProviderStatus;
  connect(): Promise<void>;
  disconnect(): void;
  destroy(): void;
}

export type SpikeProviderFactory = (doc: Y.Doc, awareness: Awareness) => SpikeProvider;

interface DeterministicProviderOptions {
  beforePublish?: () => Promise<void>;
  ready?: Promise<unknown>;
}

type PendingDelivery =
  | {
      kind: "document";
      target: DeterministicProvider;
      update: Uint8Array;
    }
  | {
      kind: "awareness";
      target: DeterministicProvider;
      sourceClientId: number;
      update: Uint8Array;
    };

/**
 * A deliberately controllable Yjs transport for the Phase 0 spike. It is not a
 * production provider: tests decide when and in what order encoded updates are
 * delivered, while reconnect always heals through state-vector reconciliation.
 */
export class DeterministicHub {
  readonly serverDoc = new Y.Doc();
  private readonly providers = new Set<DeterministicProvider>();
  private pending: PendingDelivery[] = [];

  constructor() {
    this.serverDoc.on("update", (update: Uint8Array, origin: unknown) => {
      if (!(origin instanceof DeterministicProvider)) return;
      for (const provider of this.providers) {
        if (provider === origin || provider.status !== "connected") continue;
        this.pending.push({ kind: "document", target: provider, update });
      }
    });
  }

  createProvider(
    doc: Y.Doc,
    awareness = new Awareness(doc),
    options: DeterministicProviderOptions = {},
  ) {
    return new DeterministicProvider(this, doc, awareness, options);
  }

  connect(provider: DeterministicProvider) {
    this.providers.add(provider);

    // Upload everything the server is missing, then download everything this
    // client is missing. No buffered packet is trusted as the recovery source.
    const upload = Y.encodeStateAsUpdate(provider.doc, Y.encodeStateVector(this.serverDoc));
    Y.applyUpdate(this.serverDoc, upload, provider);
    const download = Y.encodeStateAsUpdate(this.serverDoc, Y.encodeStateVector(provider.doc));
    Y.applyUpdate(provider.doc, download, provider);

    this.publishCurrentAwareness(provider);
  }

  disconnect(provider: DeterministicProvider) {
    this.pending = this.pending.filter(
      (delivery) =>
        delivery.kind !== "awareness" || delivery.sourceClientId !== provider.awareness.clientID,
    );
    for (const peer of this.providers) {
      if (peer === provider || peer.status !== "connected") continue;
      peer.removeRemoteAwareness(provider.awareness.clientID);
    }
  }

  unregister(provider: DeterministicProvider) {
    this.providers.delete(provider);
    this.pending = this.pending.filter((delivery) => delivery.target !== provider);
  }

  receiveDocumentUpdate(provider: DeterministicProvider, update: Uint8Array) {
    Y.applyUpdate(this.serverDoc, update, provider);
  }

  receiveAwarenessUpdate(provider: DeterministicProvider, update: Uint8Array) {
    for (const peer of this.providers) {
      if (peer === provider || peer.status !== "connected") continue;
      this.pending.push({
        kind: "awareness",
        target: peer,
        sourceClientId: provider.awareness.clientID,
        update,
      });
    }
  }

  pendingCount() {
    return this.pending.length;
  }

  pendingDocumentCount() {
    return this.pending.filter((delivery) => delivery.kind === "document").length;
  }

  duplicatePending() {
    this.pending = this.pending.flatMap((delivery) => [delivery, delivery]);
  }

  dropPending() {
    this.pending = [];
  }

  flush(order: "forward" | "reverse" = "forward") {
    const deliveries = this.pending;
    this.pending = [];
    if (order === "reverse") deliveries.reverse();

    for (const delivery of deliveries) {
      if (delivery.target.status !== "connected") continue;
      if (delivery.kind === "document") {
        delivery.target.receiveDocumentUpdate(delivery.update);
      } else {
        delivery.target.receiveAwarenessUpdate(delivery.update);
      }
    }
  }

  destroy() {
    for (const provider of this.providers) provider.destroy();
    this.providers.clear();
    this.pending = [];
    this.serverDoc.destroy();
  }

  private publishCurrentAwareness(provider: DeterministicProvider) {
    const localState = provider.awareness.getLocalState();
    if (localState !== null) {
      const update = encodeAwarenessUpdate(provider.awareness, [provider.awareness.clientID]);
      this.receiveAwarenessUpdate(provider, update);
    }

    for (const peer of this.providers) {
      if (peer === provider || peer.status !== "connected") continue;
      const peerState = peer.awareness.getLocalState();
      if (peerState === null) continue;
      const update = encodeAwarenessUpdate(peer.awareness, [peer.awareness.clientID]);
      this.pending.push({
        kind: "awareness",
        target: provider,
        sourceClientId: peer.awareness.clientID,
        update,
      });
    }
  }
}

export class DeterministicProvider implements SpikeProvider {
  status: ProviderStatus = "offline";
  outboundUpdates = 0;
  safelyQueuedUpdates = 0;
  persistenceError: unknown = null;
  readonly observedUpdateOrigins: unknown[] = [];
  private destroyed = false;
  private durabilityChain = Promise.resolve();

  private readonly onDocumentUpdate = (update: Uint8Array, origin: unknown) => {
    this.observedUpdateOrigins.push(origin);
    if (origin === this) return;
    if (this.options.beforePublish) {
      this.durabilityChain = this.durabilityChain
        .then(async () => {
          await this.options.beforePublish?.();
          this.safelyQueuedUpdates += 1;
          if (this.status === "connected") this.publishDocumentUpdate(update);
        })
        .catch((error: unknown) => {
          this.persistenceError = error;
          this.status = "error";
        });
      return;
    }
    if (this.status !== "connected") return;
    this.publishDocumentUpdate(update);
  };

  private publishDocumentUpdate(update: Uint8Array) {
    this.outboundUpdates += 1;
    this.hub.receiveDocumentUpdate(this, update);
  }

  private readonly onAwarenessUpdate = (
    change: { added: number[]; updated: number[]; removed: number[] },
    origin: unknown,
  ) => {
    if (origin === this || this.status !== "connected") return;
    const clients = [...change.added, ...change.updated, ...change.removed];
    const update = encodeAwarenessUpdate(this.awareness, clients);
    this.hub.receiveAwarenessUpdate(this, update);
  };

  constructor(
    private readonly hub: DeterministicHub,
    readonly doc: Y.Doc,
    readonly awareness: Awareness,
    private readonly options: DeterministicProviderOptions = {},
  ) {
    doc.on("update", this.onDocumentUpdate);
    awareness.on("update", this.onAwarenessUpdate);
  }

  async connect() {
    if (this.status === "connected") return;
    this.status = "connecting";
    await this.options.ready;
    await this.durabilityChain;
    if (this.persistenceError) {
      this.status = "error";
      throw this.persistenceError;
    }
    this.status = "connected";
    this.hub.connect(this);
  }

  async waitForDurability() {
    await this.durabilityChain;
    if (this.persistenceError) throw this.persistenceError;
  }

  disconnect() {
    if (this.status === "offline") return;
    this.hub.disconnect(this);
    this.status = "offline";
  }

  receiveDocumentUpdate(update: Uint8Array) {
    Y.applyUpdate(this.doc, update, this);
  }

  receiveAwarenessUpdate(update: Uint8Array) {
    applyAwarenessUpdate(this.awareness, update, this);
  }

  removeRemoteAwareness(clientId: number) {
    if (!this.awareness.getStates().has(clientId)) return;
    removeAwarenessStates(this.awareness, [clientId], this);
  }

  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    this.disconnect();
    this.doc.off("update", this.onDocumentUpdate);
    this.awareness.off("update", this.onAwarenessUpdate);
    this.awareness.destroy();
    this.hub.unregister(this);
  }
}

export interface ClientMetrics {
  derivedUpdates: number;
  ordinarySaveCallbacks: number;
  remoteTransactions: number;
}

interface ClientSession {
  doc: Y.Doc;
  text: Y.Text;
  awareness: Awareness;
  provider: SpikeProvider;
  undoManager: Y.UndoManager;
}

function createPresenceExtension(session: ClientSession) {
  return ViewPlugin.fromClass(
    class {
      constructor(private readonly view: EditorView) {
        this.publish();
      }

      update(update: ViewUpdate) {
        if (update.selectionSet || update.docChanged) this.publish();
      }

      destroy() {
        session.awareness.setLocalStateField("cursor", null);
      }

      private publish() {
        const selection = this.view.state.selection.main;
        session.awareness.setLocalStateField("cursor", {
          anchor: Y.createRelativePositionFromTypeIndex(session.text, selection.anchor),
          head: Y.createRelativePositionFromTypeIndex(session.text, selection.head),
        });
      }
    },
  );
}

function collaborationExtensions(session: ClientSession) {
  return [
    Prec.highest(keymap.of(yUndoManagerKeymap)),
    yCollab(session.text, session.awareness, { undoManager: session.undoManager }),
    createPresenceExtension(session),
  ];
}

function createSession(factory: SpikeProviderFactory): ClientSession {
  const doc = new Y.Doc();
  const text = doc.getText("content");
  const awareness = new Awareness(doc);
  const provider = factory(doc, awareness);
  return {
    doc,
    text,
    awareness,
    provider,
    undoManager: new Y.UndoManager(text),
  };
}

export class MountedCollaborationClient {
  readonly metrics: ClientMetrics = {
    derivedUpdates: 0,
    ordinarySaveCallbacks: 0,
    remoteTransactions: 0,
  };

  readonly parent = document.createElement("div");
  readonly collaborationCompartment = new Compartment();
  readonly setupCompartment = new Compartment();
  view: EditorView;
  session: ClientSession;

  private destroyed = false;

  private constructor(
    private providerFactory: SpikeProviderFactory,
    readonly name: string,
    session: ClientSession,
  ) {
    this.session = session;
    document.body.append(this.parent);
    session.awareness.setLocalStateField("user", {
      name,
      color: name === "A" ? "#cc0000" : "#0000cc",
      colorLight: name === "A" ? "#cc000033" : "#0000cc33",
    });

    this.view = new EditorView({
      parent: this.parent,
      state: EditorState.create({
        doc: session.text.toJSON(),
        extensions: [
          this.setupCompartment.of(prosemarkBasicSetup({ history: false })),
          this.collaborationCompartment.of(collaborationExtensions(session)),
          EditorView.updateListener.of((update) => {
            if (!update.docChanged) return;
            this.metrics.derivedUpdates += 1;
            const remote = update.transactions.some(
              (transaction) => transaction.annotation(ySyncAnnotation) !== undefined,
            );
            if (remote) {
              this.metrics.remoteTransactions += 1;
              return;
            }
            const writerLifecycle = update.transactions.some((transaction) =>
              transaction.isUserEvent("writer"),
            );
            if (!writerLifecycle) this.metrics.ordinarySaveCallbacks += 1;
          }),
        ],
      }),
    });
  }

  static async create(factory: SpikeProviderFactory, name: string) {
    const session = createSession(factory);
    await session.provider.connect();
    return new MountedCollaborationClient(factory, name, session);
  }

  get doc() {
    return this.session.doc;
  }

  get text() {
    return this.session.text;
  }

  get awareness() {
    return this.session.awareness;
  }

  get provider() {
    return this.session.provider;
  }

  get localYjsOrigin() {
    return this.view.state.facet(ySyncFacet);
  }

  insert(position: number, value: string) {
    this.view.dispatch({ changes: { from: position, insert: value } });
  }

  replace(from: number, to: number, value: string) {
    this.view.dispatch({ changes: { from, to, insert: value } });
  }

  select(anchor: number, head = anchor) {
    this.view.dispatch({ selection: EditorSelection.range(anchor, head) });
  }

  stopUndoCapture() {
    this.session.undoManager.stopCapturing();
  }

  undoThroughEditor() {
    const event = new KeyboardEvent("keydown", { key: "z", ctrlKey: true, bubbles: true });
    return runScopeHandlers(this.view, event, "editor");
  }

  redoThroughEditor() {
    const event = new KeyboardEvent("keydown", {
      key: "y",
      ctrlKey: true,
      bubbles: true,
    });
    return runScopeHandlers(this.view, event, "editor");
  }

  detachCollaboration() {
    this.view.dispatch({ effects: this.collaborationCompartment.reconfigure([]) });
  }

  attachCollaboration() {
    this.view.dispatch({
      effects: this.collaborationCompartment.reconfigure(collaborationExtensions(this.session)),
    });
  }

  reloadFromSharedText() {
    this.detachCollaboration();
    this.view.dispatch({
      changes: {
        from: 0,
        to: this.view.state.doc.length,
        insert: this.session.text.toJSON(),
      },
      selection: EditorSelection.cursor(0),
      annotations: Transaction.addToHistory.of(false),
      userEvent: "writer.reload",
    });
    this.attachCollaboration();
  }

  async swapDocument(nextProviderFactory: SpikeProviderFactory = this.providerFactory) {
    const previous = this.session;
    this.detachCollaboration();
    this.view.dispatch({ effects: this.setupCompartment.reconfigure([]) });
    this.view.dispatch({
      effects: this.setupCompartment.reconfigure(prosemarkBasicSetup({ history: false })),
    });

    const next = createSession(nextProviderFactory);
    await next.provider.connect();
    next.awareness.setLocalStateField("user", previous.awareness.getLocalState()?.user);

    this.view.dispatch({
      changes: { from: 0, to: this.view.state.doc.length, insert: next.text.toJSON() },
      selection: EditorSelection.cursor(0),
      annotations: Transaction.addToHistory.of(false),
      userEvent: "writer.swap",
    });

    this.session = next;
    this.providerFactory = nextProviderFactory;
    this.attachCollaboration();
    previous.provider.destroy();
    previous.doc.destroy();
    return previous;
  }

  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    this.view.destroy();
    this.session.provider.destroy();
    this.session.doc.destroy();
    this.parent.remove();
  }
}

interface RelativeSelection {
  anchor: Y.RelativePosition;
  head: Y.RelativePosition;
}

export function resolveAwarenessCursor(doc: Y.Doc, range: RelativeSelection | null | undefined) {
  if (!range) return null;
  const anchor = Y.createAbsolutePositionFromRelativePosition(range.anchor, doc);
  const head = Y.createAbsolutePositionFromRelativePosition(range.head, doc);
  if (!anchor || !head) return null;
  return { anchor: anchor.index, head: head.index };
}

export async function waitFor(predicate: () => boolean, message: string, timeoutMs = 5_000) {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error(message);
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

export async function checkpointIndexedDbPersistence(
  persistence: IndexeddbPersistence,
  doc: Y.Doc,
) {
  const database = persistence.db;
  if (!database) throw new Error("IndexedDB persistence is not ready");
  const stateVector = Y.encodeStateVector(doc);
  const checkpoint = stateVector.buffer.slice(
    stateVector.byteOffset,
    stateVector.byteOffset + stateVector.byteLength,
  );

  await new Promise<void>((resolve, reject) => {
    // Sharing the updates store makes this transaction wait behind the update
    // transaction opened synchronously by y-indexeddb's document listener.
    const transaction = database.transaction(["updates", "custom"], "readwrite");
    transaction.objectStore("custom").put(checkpoint, "durability-checkpoint");
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });
}
