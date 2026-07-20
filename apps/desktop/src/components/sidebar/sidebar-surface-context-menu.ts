import { Menu } from "@tauri-apps/api/menu/menu";
import { CheckMenuItem } from "@tauri-apps/api/menu/checkMenuItem";

export type SidebarSurfaceToggleId = "toggle-search" | "toggle-recents";

export interface SidebarSurfaceMenuState {
  showSearch: boolean;
  showRecents: boolean;
  onToggleSearch: (visible: boolean) => void;
  onToggleRecents: (visible: boolean) => void;
}

/**
 * Build the check-item entries for the sidebar surface context menu (shown on
 * right-clicking empty sidebar space or section headers). Both toggles are
 * always listed (checked = currently visible) so a hidden one can be re-shown
 * from the same menu. Pulled out from `showSidebarSurfaceContextMenu` so it
 * can be unit-tested without the Tauri runtime.
 */
export function buildSidebarSurfaceMenuItemsSpec(
  state: SidebarSurfaceMenuState,
): Array<{ id: SidebarSurfaceToggleId; text: string; checked: boolean; action: () => void }> {
  return [
    {
      id: "toggle-search",
      text: "Search",
      checked: state.showSearch,
      action: () => state.onToggleSearch(!state.showSearch),
    },
    {
      id: "toggle-recents",
      text: "Recents",
      checked: state.showRecents,
      action: () => state.onToggleRecents(!state.showRecents),
    },
  ];
}

/**
 * Build a Tauri native menu of check items and pop it up at the cursor.
 * The menu dismisses through the OS, not via JS.
 */
export async function showSidebarSurfaceContextMenu(state: SidebarSurfaceMenuState): Promise<void> {
  const spec = buildSidebarSurfaceMenuItemsSpec(state);

  const items = await Promise.all(
    spec.map((entry) =>
      CheckMenuItem.new({
        id: entry.id,
        text: entry.text,
        checked: entry.checked,
        action: entry.action,
      }),
    ),
  );

  const menu = await Menu.new({ items });
  await menu.popup();
}
