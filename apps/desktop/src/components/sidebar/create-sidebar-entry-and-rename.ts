import type { SidebarEntryKind } from "@/lib/tauri";

interface CreatedSidebarEntry {
  path: string;
}

interface SidebarEntryCreationDependencies {
  expandParent: () => void | Promise<void>;
  createEntry: (kind: SidebarEntryKind) => Promise<CreatedSidebarEntry>;
  refreshRoot: () => Promise<void>;
  startRenaming: (path: string) => void;
  isCurrentWorkspace: () => boolean;
}

/**
 * Keep creation ordering explicit: the parent tree must be open and contain
 * the new entry before its inline rename input can mount. Workspace identity
 * checks prevent completions from an old workspace mutating the new one.
 */
export async function createSidebarEntryAndRename(
  kind: SidebarEntryKind,
  dependencies: SidebarEntryCreationDependencies,
): Promise<void> {
  if (!dependencies.isCurrentWorkspace()) return;
  await dependencies.expandParent();
  if (!dependencies.isCurrentWorkspace()) return;

  const entry = await dependencies.createEntry(kind);
  if (!dependencies.isCurrentWorkspace()) return;

  await dependencies.refreshRoot();
  if (!dependencies.isCurrentWorkspace()) return;

  dependencies.startRenaming(entry.path);
}
