import { useEffect, useState } from "react";
import { listSystemFonts } from "@/lib/tauri";

// Shared across all three Typography rows. Clear on failure so a later mount
// can retry the IPC request.
let cache: Promise<string[]> | null = null;

interface SystemFontsState {
  fonts: string[] | null;
  error: boolean;
}

export function useSystemFonts(): SystemFontsState {
  const [state, setState] = useState<SystemFontsState>({ fonts: null, error: false });

  useEffect(() => {
    let cancelled = false;
    cache ??= listSystemFonts();
    cache.then(
      (fonts) => {
        if (!cancelled) setState({ fonts, error: false });
      },
      (requestError: unknown) => {
        cache = null;
        console.error("Failed to list system fonts", requestError);
        if (!cancelled) setState({ fonts: null, error: true });
      },
    );
    return () => {
      cancelled = true;
    };
  }, []);

  return state;
}
