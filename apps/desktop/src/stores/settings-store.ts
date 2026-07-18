import { create } from "zustand";
import * as tauri from "@/lib/tauri";
import { applyCssVarBindings, applyTheme } from "@/lib/theme";
import type { SettingsMap, SettingKey } from "@/lib/settings-schema";

interface SettingsState {
  /** Flat record from key → value. Stored as `Record<string, unknown>` since
   *  IPC returns untyped JSON; per-key reads should go through the typed
   *  `useSetting<K>` hook (or `getSetting<K>`) which narrows via SettingsMap. */
  settings: Record<string, unknown>;
  isLoaded: boolean;

  loadSettings: () => Promise<void>;
  getSetting: <K extends SettingKey>(key: K) => SettingsMap[K] | undefined;
  setSetting: (key: string, value: unknown, scope?: "global" | "workspace") => Promise<void>;
  resetSetting: (key: string, scope?: "global" | "workspace") => Promise<void>;
  /** Single entry point for hydrating settings from the backend. Sets
   *  `isLoaded`, replaces the store, and runs side effects (theme tokens,
   *  data-theme attribute, css-var bindings). Call from startup and from
   *  any future "reload from backend" path — never push settings via setState
   *  elsewhere. The schema is not stored: it's a static import from
   *  `@/lib/settings-schema`. */
  hydrateFromBackend: (payload: { settings: Record<string, unknown> }) => void;
}

function applySettingsSideEffects(settings: Record<string, unknown>) {
  applyTheme(settings["appearance.theme"], settings);
  applyCssVarBindings(settings);
}

interface PersistedSettingValue {
  exists: boolean;
  value: unknown;
}

interface SettingWriteQueue {
  tail: Promise<void>;
  latestVersion: number;
  lastPersisted: PersistedSettingValue;
}

// One ordered persistence lane per key. Settings remain optimistic in Zustand
// and CSS, but an older IPC write can never finish after a newer write.
const settingWriteQueues = new Map<string, SettingWriteQueue>();

function getWriteQueue(key: string, settings: Record<string, unknown>): SettingWriteQueue {
  const existing = settingWriteQueues.get(key);
  if (existing) return existing;
  const queue: SettingWriteQueue = {
    tail: Promise.resolve(),
    latestVersion: 0,
    lastPersisted: {
      exists: Object.prototype.hasOwnProperty.call(settings, key),
      value: settings[key],
    },
  };
  settingWriteQueues.set(key, queue);
  return queue;
}

function persistedValueFor(key: string, settings: Record<string, unknown>): PersistedSettingValue {
  return {
    exists: Object.prototype.hasOwnProperty.call(settings, key),
    value: settings[key],
  };
}

function replaceSettingValue(
  settings: Record<string, unknown>,
  key: string,
  persisted: PersistedSettingValue,
): Record<string, unknown> {
  const nextSettings = { ...settings };
  if (persisted.exists) nextSettings[key] = persisted.value;
  else delete nextSettings[key];
  return nextSettings;
}

export const useSettingsStore = create<SettingsState>((set, get) => ({
  settings: {},
  isLoaded: false,

  loadSettings: async () => {
    const settings = await tauri.getSettings();
    set({ settings, isLoaded: true });
    applySettingsSideEffects(settings);
  },

  getSetting: <K extends SettingKey>(key: K): SettingsMap[K] | undefined => {
    return get().settings[key as string] as SettingsMap[K] | undefined;
  },

  setSetting: async (key: string, value: unknown, scope: "global" | "workspace" = "global") => {
    const queue = getWriteQueue(key, get().settings);
    const version = ++queue.latestVersion;

    set((state) => ({
      settings: { ...state.settings, [key]: value },
    }));
    applySettingsSideEffects(get().settings);

    const write = queue.tail
      .catch(() => {
        // A later queued value still gets a chance to persist after an earlier
        // failure; rollback is decided by mutation version below.
      })
      .then(() => tauri.setSetting(key, value, scope));
    queue.tail = write;

    try {
      await write;
      queue.lastPersisted = { exists: true, value };
    } catch (error) {
      if (queue.latestVersion === version) {
        set((state) => ({
          settings: replaceSettingValue(state.settings, key, queue.lastPersisted),
        }));
        applySettingsSideEffects(get().settings);
      }
      throw error;
    } finally {
      if (queue.tail === write) settingWriteQueues.delete(key);
    }
  },

  resetSetting: async (key: string, scope: "global" | "workspace" = "global") => {
    const queue = getWriteQueue(key, get().settings);
    const version = ++queue.latestVersion;
    let resetValue = queue.lastPersisted;

    const write = queue.tail
      .catch(() => {
        // Reset still runs after a failed earlier mutation in this key's lane.
      })
      .then(async () => {
        await tauri.resetSetting(key, scope);
        resetValue = persistedValueFor(key, await tauri.getSettings());
      });
    queue.tail = write;

    try {
      await write;
      queue.lastPersisted = resetValue;
      if (queue.latestVersion === version) {
        set((state) => ({
          settings: replaceSettingValue(state.settings, key, resetValue),
        }));
        applySettingsSideEffects(get().settings);
      }
    } catch (error) {
      if (queue.latestVersion === version) {
        set((state) => ({
          settings: replaceSettingValue(state.settings, key, queue.lastPersisted),
        }));
        applySettingsSideEffects(get().settings);
      }
      throw error;
    } finally {
      if (queue.tail === write) settingWriteQueues.delete(key);
    }
  },

  hydrateFromBackend: ({ settings }) => {
    set({ settings, isLoaded: true });
    applySettingsSideEffects(settings);
  },
}));

// Settings are hydrated by resolveStartup() via get_startup_state before the first render.
// loadSettings() remains available for runtime reloads (e.g. settings page).
