import * as tauri from "@/lib/tauri";
import type { DirEntry } from "@/types/fs";

export interface SidebarTerminalActionDependencies {
  openDirectory: (path: string | null) => Promise<void>;
  showError: (message: string) => void;
}

const runtimeDependencies: SidebarTerminalActionDependencies = {
  openDirectory: (path) => tauri.openDirectoryInTerminal(path),
  showError: (message) => window.alert(message),
};

/** Launch a terminal for either the workspace root (`null`) or one selected
 * directory. This is the single frontend owner of terminal-action errors. */
export async function openSidebarDirectoryInTerminal(
  path: string | null,
  dependencies: SidebarTerminalActionDependencies = runtimeDependencies,
): Promise<void> {
  try {
    await dependencies.openDirectory(path);
  } catch (error) {
    dependencies.showError(
      `Failed to open terminal: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

/** Bind a folder row to the shared terminal action without leaking the
 * workspace-root fallback into folder-menu construction. */
export function createFolderTerminalAction(
  entry: Pick<DirEntry, "path">,
  dependencies?: SidebarTerminalActionDependencies,
): () => void {
  return () => {
    void openSidebarDirectoryInTerminal(entry.path, dependencies);
  };
}
