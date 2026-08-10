import { useState, type MouseEvent } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import { Search01Icon } from "@hugeicons/core-free-icons";
import { useOpenCommandPalette } from "@/hooks/use-command-palette";
import { useBooleanSetting, useSetSetting } from "@/hooks/use-settings";
import { useRefreshDirectory } from "@/hooks/use-file-tree";
import { useWorkspaceRoot } from "@/hooks/use-workspace";
import { getWorkspaceIdentity, isCurrentWorkspaceIdentity } from "@/hooks/workspace-api";
import { ScrollFade } from "@/components/scroll-fade";
import * as tauri from "@/lib/tauri";
import { createSidebarEntryAndRename } from "./create-sidebar-entry-and-rename";
import { SidebarNavigator } from "./sidebar-navigator";
import { showSidebarSurfaceContextMenu } from "./sidebar-surface-context-menu";
import { openSidebarDirectoryInTerminal } from "./sidebar-terminal-action";

export function FileBrowser() {
  const openCommandPalette = useOpenCommandPalette();
  const setSetting = useSetSetting();
  const showSearch = useBooleanSetting("appearance.sidebar-show-search");
  const showRecents = useBooleanSetting("appearance.sidebar-show-recents");
  const root = useWorkspaceRoot();
  const refreshDirectory = useRefreshDirectory();
  const [renamingPath, setRenamingPath] = useState<string | null>(null);
  const [everythingCollapsed, setEverythingCollapsed] = useState(false);

  const createRootEntry = (kind: tauri.SidebarEntryKind) => {
    if (!root) return;
    const identity = getWorkspaceIdentity();
    void createSidebarEntryAndRename(kind, {
      expandParent: () => setEverythingCollapsed(false),
      createEntry: (entryKind) => tauri.createSidebarEntry(root, entryKind),
      refreshRoot: () => refreshDirectory(root),
      startRenaming: setRenamingPath,
      isCurrentWorkspace: () => isCurrentWorkspaceIdentity(identity),
    }).catch((error: unknown) => {
      window.alert(
        `Failed to create ${kind}: ${error instanceof Error ? error.message : String(error)}`,
      );
    });
  };

  const runWorkspaceAction = (label: string, action: () => Promise<void>) => {
    void action().catch((error: unknown) => {
      window.alert(`${label}: ${error instanceof Error ? error.message : String(error)}`);
    });
  };

  // File and folder rows stop propagation from their own context menus, so
  // this only fires for the sidebar surface: empty space, section headers,
  // and the search button.
  const handleSurfaceContextMenu = (event: MouseEvent<HTMLDivElement>) => {
    event.preventDefault();
    void showSidebarSurfaceContextMenu({
      showSearch,
      showRecents,
      workspaceActions: root
        ? {
            onNewFile: () => createRootEntry("file"),
            onNewFolder: () => createRootEntry("folder"),
            onOpenInTerminal: () => {
              void openSidebarDirectoryInTerminal(null);
            },
            onOpenInFileManager: () =>
              runWorkspaceAction(
                "Failed to open workspace folder",
                tauri.openWorkspaceInFileManager,
              ),
          }
        : null,
      onToggleSearch: (visible) => {
        void setSetting("appearance.sidebar-show-search", visible);
      },
      onToggleRecents: (visible) => {
        void setSetting("appearance.sidebar-show-recents", visible);
      },
    });
  };

  return (
    <div className="flex h-full min-h-0 flex-col px-3" onContextMenu={handleSurfaceContextMenu}>
      {showSearch && (
        <div
          className="flex items-center"
          style={{
            height: "calc(var(--chrome-control-height) + var(--chrome-control-padding) * 2)",
            padding: "var(--chrome-control-padding) 0",
          }}
        >
          <button
            type="button"
            data-sidebar-search-button
            onClick={() => openCommandPalette()}
            className="relative flex w-full items-center rounded-lg border border-transparent bg-[var(--surface-input)] pl-[34px] pr-3 text-[13px] text-[var(--text-muted)] transition-colors hover:text-[var(--fg-base)] h-[var(--chrome-control-height)]"
          >
            <span
              aria-hidden="true"
              className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-current"
            >
              <HugeiconsIcon icon={Search01Icon} size={16} color="currentColor" strokeWidth={2} />
            </span>
            Search
            <kbd className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-[11px] text-current">
              ⌘<span className="ml-0.5">P</span>
            </kbd>
          </button>
        </div>
      )}

      <ScrollFade className="min-h-0 flex-1 overflow-y-scroll scrollbar-none">
        <SidebarNavigator
          renamingPath={renamingPath}
          onRenamingPathChange={setRenamingPath}
          everythingCollapsed={everythingCollapsed}
          onEverythingCollapsedChange={setEverythingCollapsed}
        />
      </ScrollFade>
    </div>
  );
}
