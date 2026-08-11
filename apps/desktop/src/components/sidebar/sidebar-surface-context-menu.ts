import { Menu } from "@tauri-apps/api/menu/menu";
import { CheckMenuItem } from "@tauri-apps/api/menu/checkMenuItem";
import { MenuItem } from "@tauri-apps/api/menu/menuItem";
import { PredefinedMenuItem } from "@tauri-apps/api/menu/predefinedMenuItem";
import { detectPlatform, openFolderLabelForPlatform, type Platform } from "./context-menu-utils";

export type SidebarSurfaceToggleId = "toggle-search" | "toggle-recents";
export type SidebarSurfaceActionId =
  | "new-file"
  | "new-folder"
  | "open-terminal"
  | "open-file-manager";

interface SidebarSurfaceWorkspaceActions {
  onNewFile: () => void;
  onNewFolder: () => void;
  onOpenInTerminal: () => void;
  onOpenInFileManager: () => void;
}

export interface SidebarSurfaceMenuState {
  showSearch: boolean;
  showRecents: boolean;
  workspaceActions: SidebarSurfaceWorkspaceActions | null;
  onToggleSearch: (visible: boolean) => void;
  onToggleRecents: (visible: boolean) => void;
}

type SidebarSurfaceMenuEntry =
  | {
      kind: "item";
      id: SidebarSurfaceActionId;
      text: string;
      action: () => void;
    }
  | {
      kind: "check";
      id: SidebarSurfaceToggleId;
      text: string;
      checked: boolean;
      action: () => void;
    }
  | { kind: "separator" };

/**
 * Build the sidebar surface menu shown on empty space and section headers.
 * Workspace actions precede the always-present visibility checks. Pulled out
 * from `showSidebarSurfaceContextMenu` so it can be tested without Tauri.
 */
export function buildSidebarSurfaceMenuItemsSpec(
  state: SidebarSurfaceMenuState,
  platform: Platform = detectPlatform(),
): SidebarSurfaceMenuEntry[] {
  const toggles: SidebarSurfaceMenuEntry[] = [
    {
      kind: "check",
      id: "toggle-search",
      text: "Search",
      checked: state.showSearch,
      action: () => state.onToggleSearch(!state.showSearch),
    },
    {
      kind: "check",
      id: "toggle-recents",
      text: "Recents",
      checked: state.showRecents,
      action: () => state.onToggleRecents(!state.showRecents),
    },
  ];

  if (!state.workspaceActions) return toggles;

  return [
    {
      kind: "item",
      id: "new-file",
      text: "New File",
      action: state.workspaceActions.onNewFile,
    },
    {
      kind: "item",
      id: "new-folder",
      text: "New Folder",
      action: state.workspaceActions.onNewFolder,
    },
    { kind: "separator" },
    {
      kind: "item",
      id: "open-terminal",
      text: "Open in Terminal",
      action: state.workspaceActions.onOpenInTerminal,
    },
    {
      kind: "item",
      id: "open-file-manager",
      text: openFolderLabelForPlatform(platform),
      action: state.workspaceActions.onOpenInFileManager,
    },
    { kind: "separator" },
    ...toggles,
  ];
}

/**
 * Build a Tauri native menu of check items and pop it up at the cursor.
 * The menu dismisses through the OS, not via JS.
 */
export async function showSidebarSurfaceContextMenu(state: SidebarSurfaceMenuState): Promise<void> {
  const spec = buildSidebarSurfaceMenuItemsSpec(state);

  const items = await Promise.all(
    spec.map((entry) => {
      if (entry.kind === "separator") {
        return PredefinedMenuItem.new({ item: "Separator" });
      }
      if (entry.kind === "check") {
        return CheckMenuItem.new({
          id: entry.id,
          text: entry.text,
          checked: entry.checked,
          action: entry.action,
        });
      }
      return MenuItem.new({ id: entry.id, text: entry.text, action: entry.action });
    }),
  );

  const menu = await Menu.new({ items });
  await menu.popup();
}
