import { useCallback, useEffect, useRef, useState } from "react";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { firstFamily, stackWithFamily } from "@/lib/font-stack";
import { detectPlatform } from "@/lib/platform";
import {
  closeNativeFontPanel,
  NATIVE_FONT_SELECTED_EVENT,
  openNativeFontPanel,
  type NativeFontSelection,
} from "@/lib/tauri";

type MaybePromise<T> = T | Promise<T>;

/** UUID-shaped opaque token using Web Crypto available on Writer's macOS
 * deployment floor. Avoid `crypto.randomUUID`, which arrived in later WebKit. */
export function makeNativeFontRequestId(
  fillRandom: (array: Uint8Array<ArrayBuffer>) => void = (array) => {
    crypto.getRandomValues(array);
  },
): string {
  const bytes = new Uint8Array(new ArrayBuffer(16));
  fillRandom(bytes);
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x40;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export interface NativeFontPanelControllerDeps {
  listenSelection: (handler: (payload: NativeFontSelection) => void) => Promise<UnlistenFn>;
  openPanel: (requestId: string, family: string) => Promise<void>;
  closePanel: (requestId: string) => Promise<void>;
  makeRequestId: () => string;
  getStack: () => string;
  onChange: (stack: string) => MaybePromise<void>;
  onError: (message: string | null) => void;
  onReadyChange: (ready: boolean) => void;
  onActiveRequestChange: (requestId: string | null) => void;
}

/** Owns the modeless native panel's external subscription and opaque request
 * lifecycle. Kept independent of React so stale-token and late-listener races
 * can be tested with deferred promises. */
export class NativeFontPanelController {
  private readonly deps: NativeFontPanelControllerDeps;
  private activeRequestId: string | null = null;
  private disposed = false;
  private listenerReady: Promise<void> | null = null;
  private unlisten: UnlistenFn | null = null;
  private openTail: Promise<void> = Promise.resolve();

  constructor(deps: NativeFontPanelControllerDeps) {
    this.deps = deps;
  }

  start(): Promise<void> {
    if (this.listenerReady) return this.listenerReady;
    this.listenerReady = this.deps
      .listenSelection((payload) => this.handleSelection(payload))
      .then((unlisten) => {
        if (this.disposed) {
          unlisten();
          return;
        }
        this.unlisten = unlisten;
        this.deps.onReadyChange(true);
      });
    return this.listenerReady;
  }

  open(): Promise<void> {
    this.openTail = this.openTail
      .catch(() => {})
      .then(async () => {
        let requestId: string | null = null;
        try {
          await this.start();
          if (this.disposed) return;

          requestId = this.deps.makeRequestId();
          this.setActiveRequest(requestId);
          await this.deps.openPanel(requestId, firstFamily(this.deps.getStack()));

          // Disposal or a later open may supersede this request while AppKit is
          // being scheduled. Exact-token close cannot disturb the newer route.
          if (this.disposed || this.activeRequestId !== requestId) {
            await this.deps.closePanel(requestId);
          }
        } catch (error) {
          if (requestId && this.activeRequestId === requestId) {
            this.setActiveRequest(null);
          }
          const message = error instanceof Error ? error.message : String(error);
          this.deps.onError(message || "Couldn't open Fonts.");
        }
      });
    return this.openTail;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.deps.onReadyChange(false);
    this.unlisten?.();
    this.unlisten = null;

    const requestId = this.activeRequestId;
    this.setActiveRequest(null);
    if (requestId) {
      void this.deps.closePanel(requestId).catch(() => {
        // Window teardown may remove the IPC target first; Rust also clears
        // the route from WindowEvent::Destroyed.
      });
    }
  }

  private handleSelection(payload: NativeFontSelection): void {
    if (this.disposed || payload.requestId !== this.activeRequestId) return;

    const currentStack = this.deps.getStack();
    const nextStack = stackWithFamily(payload.family, currentStack);
    if (nextStack === currentStack) return;

    this.deps.onError(null);
    void Promise.resolve(this.deps.onChange(nextStack)).catch((error: unknown) => {
      this.deps.onError(error instanceof Error ? error.message : String(error));
    });
  }

  private setActiveRequest(requestId: string | null): void {
    this.activeRequestId = requestId;
    this.deps.onActiveRequestChange(requestId);
  }
}

interface UseNativeFontPanelOptions {
  value: string;
  onChange: (value: string) => MaybePromise<void>;
}

export function useNativeFontPanel({ value, onChange }: UseNativeFontPanelOptions) {
  const supported = detectPlatform() === "macos";
  const valueRef = useRef(value);
  const onChangeRef = useRef(onChange);
  const controllerRef = useRef<NativeFontPanelController | null>(null);
  const [ready, setReady] = useState(false);
  const [activeRequestId, setActiveRequestId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  valueRef.current = value;
  onChangeRef.current = onChange;

  useEffect(() => {
    if (!supported) return;
    let mounted = true;
    const controller = new NativeFontPanelController({
      listenSelection: (handler) =>
        listen<NativeFontSelection>(NATIVE_FONT_SELECTED_EVENT, (event) => handler(event.payload)),
      openPanel: openNativeFontPanel,
      closePanel: closeNativeFontPanel,
      makeRequestId: makeNativeFontRequestId,
      getStack: () => valueRef.current,
      onChange: (stack) => {
        // Make a second native event in the same render frame use the stack we
        // just accepted rather than the value captured by the previous render.
        valueRef.current = stack;
        return onChangeRef.current(stack);
      },
      onError: (message) => {
        if (mounted) setError(message);
      },
      onReadyChange: (isReady) => {
        if (mounted) setReady(isReady);
      },
      onActiveRequestChange: (requestId) => {
        if (mounted) setActiveRequestId(requestId);
      },
    });
    controllerRef.current = controller;
    void controller.start().catch((startError: unknown) => {
      if (mounted) {
        setError(startError instanceof Error ? startError.message : String(startError));
      }
    });

    return () => {
      mounted = false;
      controllerRef.current = null;
      controller.dispose();
    };
  }, [supported]);

  const open = useCallback(() => {
    setError(null);
    return controllerRef.current?.open() ?? Promise.resolve();
  }, []);

  return { supported, ready, activeRequestId, error, clearError: () => setError(null), open };
}
