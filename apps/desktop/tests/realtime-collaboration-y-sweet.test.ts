// @vitest-environment happy-dom

import { afterEach, describe, expect, test } from "vite-plus/test";
import { createYjsProvider, type YSweetProvider } from "@y-sweet/client";
import type { Awareness } from "y-protocols/awareness";
import { WebSocket as NodeWebSocket } from "ws";
import * as Y from "yjs";
import {
  MountedCollaborationClient,
  type ProviderStatus,
  resolveAwarenessCursor,
  type SpikeProvider,
  waitFor,
} from "./support/realtime-collaboration-spike";
import { YSweetSpikeServer } from "./support/y-sweet-spike-server";

class YSweetSpikeProvider implements SpikeProvider {
  private desiredLocalState: ReturnType<Awareness["getLocalState"]> = null;
  private disconnectSettled: Promise<void> = Promise.resolve();
  private wantsConnection = false;

  constructor(
    private readonly inner: YSweetProvider,
    readonly awareness: Awareness,
  ) {
    this.inner.on("connection-status", this.enforceConnectionIntent);
  }

  get status(): ProviderStatus {
    if (this.inner.status === "connected") return "connected";
    if (this.inner.status === "error") return "error";
    if (this.inner.status === "offline") return "offline";
    return "connecting";
  }

  async connect() {
    this.captureDesiredLocalState();
    this.wantsConnection = true;
    await this.disconnectSettled;
    await this.inner.connect();
    await waitFor(() => this.inner.status === "connected", "y-sweet provider did not sync");
    // Publish after the sync handshake has fully unwound. Publishing in the same
    // stack as the connected transition is not relayed reliably by y-sweet 0.9.1.
    await new Promise((resolve) => setTimeout(resolve, 25));
    if (this.desiredLocalState) {
      this.awareness.setLocalState(this.desiredLocalState);
      await new Promise((resolve) => setTimeout(resolve, 0));
      this.awareness.setLocalState(this.desiredLocalState);
    }
  }

  disconnect() {
    this.captureDesiredLocalState();
    this.wantsConnection = false;
    // Preserve the desired local state while the socket is down. The server
    // removes this connection's remote presence on close; websocketOpen then
    // republishes the retained state on a later connect.
    this.disconnectSettled = Promise.race([
      new Promise<void>((resolve) => this.inner.once("connection-close", () => resolve())),
      new Promise<void>((resolve) => setTimeout(resolve, 250)),
    ]).then(async () => {
      // y-sweet 0.9.1's close callback may briefly start its reconnect loop
      // after an explicit disconnect. Let the intent listener settle it.
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    this.inner.disconnect();
  }

  destroy() {
    this.wantsConnection = false;
    this.awareness.setLocalState(null);
    this.inner.destroy();
  }

  private captureDesiredLocalState() {
    const localState = this.awareness.getLocalState();
    if (localState) this.desiredLocalState = localState;
  }

  private readonly enforceConnectionIntent = () => {
    if (!this.wantsConnection && this.inner.status !== "offline") this.inner.disconnect();
  };
}

const servers: YSweetSpikeServer[] = [];
const clients: MountedCollaborationClient[] = [];

afterEach(async () => {
  for (const client of clients.splice(0)) client.destroy();
  for (const server of servers.splice(0)) await server.destroy();
  document.body.replaceChildren();
});

describe("Phase 0 y-sweet provider spike", () => {
  test("syncs two real editors, survives a server restart, and reconciles offline work", async () => {
    const server = await YSweetSpikeServer.create();
    servers.push(server);
    await server.start();
    const documentId = `writer-${crypto.randomUUID()}`;
    const factory = (doc: Y.Doc, awareness: Awareness) => {
      const provider = createYjsProvider(doc, documentId, () => server.clientToken(documentId), {
        awareness,
        connect: false,
        showDebuggerLink: false,
        WebSocketPolyfill: NodeWebSocket as unknown as typeof WebSocket,
      });
      return new YSweetSpikeProvider(provider, awareness);
    };

    let a = await MountedCollaborationClient.create(factory, "A");
    const b = await MountedCollaborationClient.create(factory, "B");
    clients.push(a, b);

    const checkpointBeforeEdit = await server.checkpointVersion();
    a.insert(0, "before restart");
    await waitFor(
      () => b.view.state.doc.toString() === "before restart",
      "second editor did not receive the initial edit",
    );
    await server.waitForCheckpointAfter(checkpointBeforeEdit);

    a.select(2);
    await waitFor(() => {
      const state = b.awareness.getStates().get(a.awareness.clientID);
      return state?.user?.name === "A" && state.cursor !== undefined;
    }, "y-sweet did not publish awareness");
    a.provider.disconnect();
    await waitFor(
      () => !b.awareness.getStates().has(a.awareness.clientID),
      "y-sweet adapter did not remove awareness on disconnect",
    );
    await a.provider.connect();
    await waitFor(() => {
      const state = b.awareness.getStates().get(a.awareness.clientID);
      return state?.user?.name === "A" && state.cursor !== undefined;
    }, "same mounted y-sweet client did not republish fresh awareness");
    expect(
      resolveAwarenessCursor(b.doc, b.awareness.getStates().get(a.awareness.clientID)?.cursor),
    ).toEqual({ anchor: 2, head: 2 });
    a.provider.disconnect();
    await waitFor(
      () => !b.awareness.getStates().has(a.awareness.clientID),
      "second disconnect did not remove awareness",
    );
    a.destroy();
    a = await MountedCollaborationClient.create(factory, "A");
    clients.push(a);
    a.select(3);
    await waitFor(
      () => b.awareness.getStates().has(a.awareness.clientID),
      "y-sweet adapter did not republish fresh awareness",
    );
    b.select(4);
    await waitFor(
      () => a.awareness.getStates().get(b.awareness.clientID)?.cursor !== undefined,
      "second client did not publish a cursor before restart",
    );

    await server.stop();
    await waitFor(
      () => a.provider.status !== "connected" && b.provider.status !== "connected",
      "providers did not observe the stopped y-sweet server",
    );

    a.insert(a.view.state.doc.length, " from A");
    b.insert(0, "B ");
    a.provider.disconnect();
    b.provider.disconnect();

    await server.start();
    const verifier = await MountedCollaborationClient.create(factory, "B");
    clients.push(verifier);
    await waitFor(
      () => verifier.view.state.doc.toString() === "before restart",
      "fresh client did not load the checkpointed server state",
    );
    verifier.destroy();
    await a.provider.connect();
    await b.provider.connect();
    await waitFor(
      () =>
        a.provider.status === "connected" &&
        b.provider.status === "connected" &&
        a.view.state.doc.toString() === b.view.state.doc.toString(),
      "editors did not reconnect and converge after y-sweet restarted",
      15_000,
    );
    await waitFor(() => {
      const aOnB = b.awareness.getStates().get(a.awareness.clientID);
      const bOnA = a.awareness.getStates().get(b.awareness.clientID);
      return (
        aOnB?.user?.name === "A" &&
        aOnB.cursor !== undefined &&
        bOnA?.user?.name === "B" &&
        bOnA.cursor !== undefined
      );
    }, "same mounted clients did not republish awareness after server restart");
    expect(a.view.state.doc.toString()).toContain("from A");
    expect(a.view.state.doc.toString()).toContain("B ");

    b.insert(b.view.state.doc.length, " after restart");
    await waitFor(
      () => a.view.state.doc.toString() === b.view.state.doc.toString(),
      "post-restart edit did not propagate",
    );
    expect(a.view.state.doc.toString()).toContain("after restart");
  }, 30_000);
});
