// @vitest-environment happy-dom

import "fake-indexeddb/auto";

import { afterEach, describe, expect, test } from "vite-plus/test";
import { clearDocument, IndexeddbPersistence } from "y-indexeddb";
import * as Y from "yjs";
import {
  DeterministicHub,
  DeterministicProvider,
  MountedCollaborationClient,
  checkpointIndexedDbPersistence,
  resolveAwarenessCursor,
} from "./support/realtime-collaboration-spike";

const hubs: DeterministicHub[] = [];
const clients: MountedCollaborationClient[] = [];

function createHarness() {
  const hub = new DeterministicHub();
  hubs.push(hub);
  return {
    hub,
    factory: (doc: Y.Doc, awareness: import("y-protocols/awareness").Awareness) =>
      hub.createProvider(doc, awareness),
  };
}

async function mountPair() {
  const harness = createHarness();
  const a = await MountedCollaborationClient.create(harness.factory, "A");
  const b = await MountedCollaborationClient.create(harness.factory, "B");
  clients.push(a, b);
  harness.hub.flush();
  return { ...harness, a, b };
}

afterEach(() => {
  for (const client of clients.splice(0)) client.destroy();
  for (const hub of hubs.splice(0)) hub.destroy();
  document.body.replaceChildren();
});

describe("Phase 0 real-time collaboration spike", () => {
  test.each(["A-first", "B-first"])(
    "converges real Writer-shaped EditorViews under concurrent and adversarial delivery (%s reconnect)",
    async (reconnectOrder) => {
      const { hub, a, b } = await mountPair();
      const providerA = a.provider as DeterministicProvider;
      const providerB = b.provider as DeterministicProvider;

      a.insert(0, "abcdef");
      expect(providerA.outboundUpdates).toBe(1);
      expect(providerA.observedUpdateOrigins).toEqual([a.localYjsOrigin]);
      expect(a.metrics.ordinarySaveCallbacks).toBe(1);
      expect(providerB.outboundUpdates).toBe(0);
      hub.flush();

      expect(b.view.state.doc.toString()).toBe("abcdef");
      expect(b.metrics.remoteTransactions).toBe(1);
      expect(b.metrics.derivedUpdates).toBe(1);
      expect(b.metrics.ordinarySaveCallbacks).toBe(0);
      expect(providerB.outboundUpdates).toBe(0);
      expect(providerB.observedUpdateOrigins).toEqual([providerB]);

      a.insert(a.view.state.doc.length, "<A-online>");
      b.insert(b.view.state.doc.length, "<B-online>");
      expect(hub.pendingDocumentCount()).toBe(2);
      hub.duplicatePending();
      hub.flush("reverse");
      expect(a.view.state.doc.toString()).toContain("<A-online>");
      expect(a.view.state.doc.toString()).toContain("<B-online>");
      expect(b.view.state.doc.toString()).toContain("<A-online>");
      expect(b.view.state.doc.toString()).toContain("<B-online>");

      providerA.disconnect();
      providerB.disconnect();
      a.replace(1, 4, "A");
      b.replace(2, 5, "B");
      a.insert(a.view.state.doc.length, "<A-offline>");
      b.insert(0, "<B-offline>");

      if (reconnectOrder === "A-first") {
        await providerA.connect();
        await providerB.connect();
      } else {
        await providerB.connect();
        await providerA.connect();
      }
      hub.duplicatePending();
      hub.flush("reverse");

      const converged = hub.serverDoc.getText("content").toJSON();
      expect(a.view.state.doc.toString()).toBe(converged);
      expect(b.view.state.doc.toString()).toBe(converged);
      expect(a.text.toJSON()).toBe(converged);
      expect(b.text.toJSON()).toBe(converged);
      expect(Y.encodeStateVector(a.doc)).toEqual(Y.encodeStateVector(b.doc));
      expect(converged).toContain("<A-offline>");
      expect(converged).toContain("<B-offline>");

      a.insert(a.view.state.doc.length, "<dropped>");
      hub.dropPending();
      expect(b.view.state.doc.toString()).not.toContain("<dropped>");
      providerB.disconnect();
      await providerB.connect();
      hub.flush("reverse");
      expect(b.view.state.doc.toString()).toBe(a.view.state.doc.toString());
      expect(b.view.state.doc.toString()).toContain("<dropped>");
    },
  );

  test("routes undo and redo through Yjs so one user never undoes a peer edit", async () => {
    const { hub, a, b } = await mountPair();

    a.insert(0, "A1");
    a.stopUndoCapture();
    hub.flush();
    b.insert(2, "B");
    b.stopUndoCapture();
    hub.flush();
    a.insert(3, "A2");
    a.stopUndoCapture();
    hub.flush();
    expect(a.view.state.doc.toString()).toBe("A1BA2");

    expect(a.undoThroughEditor()).toBe(true);
    hub.flush();
    expect(a.view.state.doc.toString()).toBe("A1B");
    expect(b.view.state.doc.toString()).toBe("A1B");

    expect(a.undoThroughEditor()).toBe(true);
    hub.flush();
    expect(a.view.state.doc.toString()).toBe("B");
    expect(b.view.state.doc.toString()).toBe("B");
    expect(a.undoThroughEditor()).toBe(true);
    hub.flush();
    expect(a.view.state.doc.toString()).toBe("B");

    expect(a.redoThroughEditor()).toBe(true);
    hub.flush();
    expect(a.view.state.doc.toString()).toBe("A1B");
    expect(b.view.state.doc.toString()).toBe("A1B");
    expect(a.redoThroughEditor()).toBe(true);
    hub.flush();
    expect(a.view.state.doc.toString()).toBe("A1BA2");
    expect(b.view.state.doc.toString()).toBe("A1BA2");
    expect(a.redoThroughEditor()).toBe(true);
    hub.flush();
    expect(a.view.state.doc.toString()).toBe("A1BA2");

    const nextDocument = createHarness();
    const previous = await a.swapDocument(nextDocument.factory);
    a.insert(0, "new document edit");
    a.stopUndoCapture();
    expect(a.undoThroughEditor()).toBe(true);
    nextDocument.hub.flush();
    expect(a.view.state.doc.toString()).toBe("");
    expect(previous.text.toJSON()).toBe("A1BA2");
  });

  test("uses ephemeral relative-position awareness and cleans it up across lifecycle changes", async () => {
    const { hub, a, b } = await mountPair();
    const providerA = a.provider as DeterministicProvider;

    a.insert(0, "word");
    hub.flush();
    a.select(2);
    hub.flush();
    const initial = b.awareness.getStates().get(a.awareness.clientID)?.cursor;
    expect(resolveAwarenessCursor(b.doc, initial)).toEqual({ anchor: 2, head: 2 });

    b.insert(0, "++");
    hub.flush();
    const remapped = b.awareness.getStates().get(a.awareness.clientID)?.cursor;
    expect(resolveAwarenessCursor(b.doc, remapped)).toEqual({ anchor: 4, head: 4 });

    providerA.disconnect();
    expect(b.awareness.getStates().has(a.awareness.clientID)).toBe(false);
    a.select(0);
    await providerA.connect();
    hub.flush();
    const fresh = b.awareness.getStates().get(a.awareness.clientID)?.cursor;
    expect(resolveAwarenessCursor(b.doc, fresh)).toEqual({ anchor: 0, head: 0 });

    const oldClientId = a.awareness.clientID;
    const nextDocument = createHarness();
    const previous = await a.swapDocument(nextDocument.factory);
    hub.flush();
    expect(b.awareness.getStates().has(oldClientId)).toBe(false);
    previous.text.insert(0, "stale");
    expect(a.view.state.doc.toString()).toBe("");

    const observer = await MountedCollaborationClient.create(nextDocument.factory, "B");
    clients.push(observer);
    nextDocument.hub.flush();
    const swappedClientId = a.awareness.clientID;
    expect(observer.awareness.getStates().has(swappedClientId)).toBe(true);
    a.destroy();
    expect(observer.awareness.getStates().has(swappedClientId)).toBe(false);

    const remounted = await MountedCollaborationClient.create(nextDocument.factory, "A");
    clients.push(remounted);
    remounted.insert(0, "remounted");
    nextDocument.hub.flush();
    expect(observer.view.state.doc.toString()).toBe("remounted");
  });

  test("detaches, reloads, reattaches, swaps, and destroys without stale bindings or saves", async () => {
    const { hub, a } = await mountPair();
    const ordinaryBefore = a.metrics.ordinarySaveCallbacks;

    a.detachCollaboration();
    a.doc.transact(() => a.text.insert(0, "remote while detached"), hub);
    expect(a.view.state.doc.toString()).toBe("");
    a.reloadFromSharedText();
    expect(a.view.state.doc.toString()).toBe("remote while detached");
    expect(a.metrics.ordinarySaveCallbacks).toBe(ordinaryBefore);

    const nextDocument = createHarness();
    const previous = await a.swapDocument(nextDocument.factory);
    previous.text.insert(0, "old document");
    expect(a.view.state.doc.toString()).toBe("");
    a.text.insert(0, "new document");
    expect(a.view.state.doc.toString()).toBe("new document");
    expect(a.metrics.ordinarySaveCallbacks).toBe(ordinaryBefore);
  });
});

describe("Phase 0 offline durability", () => {
  test("gates publication on IndexedDB, recreates the mounted client offline, and converges", async () => {
    const databaseName = `writer-collaboration-${crypto.randomUUID()}`;
    const hub = new DeterministicHub();
    hubs.push(hub);
    const peer = await MountedCollaborationClient.create(
      (doc, awareness) => hub.createProvider(doc, awareness),
      "B",
    );
    clients.push(peer);
    peer.insert(0, "peer edit ");
    hub.flush();

    let firstPersistence: IndexeddbPersistence | undefined;
    let firstProvider: DeterministicProvider | undefined;
    const firstClient = await MountedCollaborationClient.create((doc, awareness) => {
      firstPersistence = new IndexeddbPersistence(databaseName, doc);
      firstProvider = hub.createProvider(doc, awareness, {
        ready: firstPersistence.whenSynced,
        beforePublish: () => checkpointIndexedDbPersistence(firstPersistence!, doc),
      });
      return firstProvider;
    }, "A");
    clients.push(firstClient);
    hub.flush();
    firstProvider!.disconnect();
    firstClient.insert(firstClient.view.state.doc.length, "offline durable edit");
    await firstProvider!.waitForDurability();
    expect(firstProvider!.safelyQueuedUpdates).toBe(1);
    expect(firstProvider!.outboundUpdates).toBe(0);
    expect(hub.serverDoc.getText("content").toJSON()).not.toContain("offline durable edit");
    await firstPersistence!.destroy();
    firstClient.destroy();

    let recreatedPersistence: IndexeddbPersistence | undefined;
    const recreated = await MountedCollaborationClient.create((doc, awareness) => {
      recreatedPersistence = new IndexeddbPersistence(databaseName, doc);
      return hub.createProvider(doc, awareness, {
        ready: recreatedPersistence.whenSynced,
        beforePublish: () => checkpointIndexedDbPersistence(recreatedPersistence!, doc),
      });
    }, "A");
    clients.push(recreated);
    hub.flush();
    expect(recreated.view.state.doc.toString()).toContain("offline durable edit");
    expect(recreated.view.state.doc.toString()).toContain("peer edit");
    expect(peer.view.state.doc.toString()).toBe(recreated.view.state.doc.toString());
    expect(await recreatedPersistence!.get("durability-checkpoint")).toBeInstanceOf(ArrayBuffer);

    await recreatedPersistence!.destroy();
    await clearDocument(databaseName);
  });

  test("publishes nothing when a mounted editor's IndexedDB checkpoint rejects", async () => {
    const databaseName = `writer-collaboration-failure-${crypto.randomUUID()}`;
    const hub = new DeterministicHub();
    hubs.push(hub);
    let persistence: IndexeddbPersistence | undefined;
    let provider: DeterministicProvider | undefined;
    const client = await MountedCollaborationClient.create((doc, awareness) => {
      persistence = new IndexeddbPersistence(databaseName, doc);
      provider = hub.createProvider(doc, awareness, {
        ready: persistence.whenSynced,
        beforePublish: () => checkpointIndexedDbPersistence(persistence!, doc),
      });
      return provider;
    }, "A");
    clients.push(client);
    await persistence!.destroy();
    client.insert(0, "must not publish");

    await expect(provider!.waitForDurability()).rejects.toBeInstanceOf(DOMException);
    expect(provider!.safelyQueuedUpdates).toBe(0);
    expect(provider!.outboundUpdates).toBe(0);
    expect(hub.serverDoc.getText("content").toJSON()).toBe("");
    await clearDocument(databaseName);
  });
});
