import { useEffect, useState } from "react";
import { listSystemFonts } from "@/lib/tauri";

// Fetched once per app run and shared across pickers (the Rust side caches
// the enumeration too). Cleared on failure so a later mount can retry.
let cache: Promise<string[]> | null = null;

interface SystemFontsState {
  /** Sorted system font family names; null while loading or on error. */
  fonts: string[] | null;
  error: boolean;
}

/** Installed system font families for the font picker. Mounting the hook
 *  triggers the (cached) IPC fetch, so only mount it when the picker is
 *  actually open. */
export function useSystemFonts(): SystemFontsState {
  const [state, setState] = useState<SystemFontsState>({ fonts: null, error: false });

  useEffect(() => {
    let cancelled = false;
    cache ??= listSystemFonts();
    cache.then(
      (fonts) => {
        if (!cancelled) setState({ fonts, error: false });
      },
      (err: unknown) => {
        cache = null;
        console.error("Failed to list system fonts", err);
        if (!cancelled) setState({ fonts: null, error: true });
      },
    );
    return () => {
      cancelled = true;
    };
  }, []);

  return state;
}
