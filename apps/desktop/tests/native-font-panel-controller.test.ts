import { describe, expect, test, vi } from "vite-plus/test";
import {
  makeNativeFontRequestId,
  NativeFontPanelController,
  type NativeFontPanelControllerDeps,
} from "../src/components/settings-panel/use-native-font-panel";
import type { NativeFontSelection } from "../src/lib/tauri";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function createHarness(overrides: Partial<NativeFontPanelControllerDeps> = {}) {
  let stack = 'Custom, Georgia, "Times New Roman", serif';
  let selectionHandler: ((payload: NativeFontSelection) => void) | null = null;
  const unlisten = vi.fn();
  const openPanel = vi.fn(async () => {});
  const closePanel = vi.fn(async () => {});
  const onChange = vi.fn(async (next: string) => {
    stack = next;
  });
  const errors: Array<string | null> = [];
  const activeRequests: Array<string | null> = [];
  const deps: NativeFontPanelControllerDeps = {
    listenSelection: async (handler) => {
      selectionHandler = handler;
      return unlisten;
    },
    openPanel,
    closePanel,
    makeRequestId: () => "request-1",
    getStack: () => stack,
    onChange,
    onError: (error) => errors.push(error),
    onReadyChange: vi.fn(),
    onActiveRequestChange: (requestId) => activeRequests.push(requestId),
    ...overrides,
  };
  const controller = new NativeFontPanelController(deps);
  return {
    controller,
    openPanel,
    closePanel,
    onChange,
    unlisten,
    errors,
    activeRequests,
    emit(payload: NativeFontSelection) {
      if (!selectionHandler) throw new Error("listener is not ready");
      selectionHandler(payload);
    },
    getStack: () => stack,
  };
}

describe("NativeFontPanelController", () => {
  test("generates a UUID token without relying on crypto.randomUUID", () => {
    const token = makeNativeFontRequestId((array) => {
      array.set(Array.from({ length: 16 }, (_, index) => index));
    });

    expect(token).toBe("00010203-0405-4607-8809-0a0b0c0d0e0f");
  });

  test("opens only after listener readiness and passes the live primary family", async () => {
    const listener = deferred<() => void>();
    const harness = createHarness({ listenSelection: () => listener.promise });
    const opening = harness.controller.open();

    expect(harness.openPanel).not.toHaveBeenCalled();
    listener.resolve(harness.unlisten);
    await opening;

    expect(harness.openPanel).toHaveBeenCalledWith("request-1", "Custom");
    expect(harness.activeRequests).toEqual(["request-1"]);
  });

  test("accepts only the active token and preserves the latest edited tail", async () => {
    const harness = createHarness();
    await harness.controller.open();

    harness.emit({ requestId: "stale", family: "Menlo" });
    expect(harness.onChange).not.toHaveBeenCalled();

    harness.emit({ requestId: "request-1", family: "Menlo" });
    await Promise.resolve();
    expect(harness.getStack()).toBe('Menlo, Georgia, "Times New Roman", serif');

    harness.emit({ requestId: "request-1", family: "Monaco" });
    await Promise.resolve();
    expect(harness.getStack()).toBe('Monaco, Georgia, "Times New Roman", serif');
  });

  test("surfaces open failure and clears the failed request", async () => {
    const harness = createHarness({ openPanel: async () => Promise.reject(new Error("no panel")) });

    await harness.controller.open();

    expect(harness.errors).toContain("no panel");
    expect(harness.activeRequests).toEqual(["request-1", null]);
  });

  test("deactivates the exact token and unregisters on dispose", async () => {
    const harness = createHarness();
    await harness.controller.open();

    harness.controller.dispose();
    await Promise.resolve();

    expect(harness.unlisten).toHaveBeenCalledOnce();
    expect(harness.closePanel).toHaveBeenCalledWith("request-1");
  });

  test("unregisters a listener that resolves after disposal without opening", async () => {
    const listener = deferred<() => void>();
    const harness = createHarness({ listenSelection: () => listener.promise });
    const starting = harness.controller.start();

    harness.controller.dispose();
    listener.resolve(harness.unlisten);
    await starting;

    expect(harness.unlisten).toHaveBeenCalledOnce();
    expect(harness.openPanel).not.toHaveBeenCalled();
  });
});
