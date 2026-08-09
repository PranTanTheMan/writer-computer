# Sidebar Empty-Area Context Menu

## Goal

Right-clicking non-row space anywhere in the workspace sidebar exposes workspace-root actions alongside the existing sidebar visibility toggles.

## Behavior

- File and folder rows keep their existing context menus.
- Right-clicking empty sidebar space, gaps, or section headers opens a native menu with:
  - New File
  - New Folder
  - Open in Terminal
  - Open in Finder on macOS (`Open in Explorer` / `Open in File Manager` elsewhere)
  - the existing Search and Recents visibility checks
- New files use the first available `Untitled.md`, `Untitled 2.md`, ... name at the workspace root.
- New folders use the first available `Untitled Folder`, `Untitled Folder 2`, ... name at the workspace root.
- File and folder creation is exclusive and collision-safe: an external process winning the same candidate name is never overwritten, and creation retries the next candidate.
- User-created empty folder trees remain visible in Everything. The existing Markdown-focused filter continues to hide directories containing only non-Markdown files, but a directory tree containing no visible files is a valid sidebar folder tree.
- After creation, Everything is expanded, the tree refreshes, and the new entry enters inline rename mode.
- Open in Terminal starts the platform terminal with the workspace root as its working directory.
- Open in Finder opens the workspace directory itself rather than revealing it in its parent.
- When no workspace is open, the workspace actions are omitted and the visibility checks remain available.

## Design

- Keep `FileBrowser` as the owner of the sidebar-surface menu and lift the tree's transient rename target to it so root creation can reuse inline rename.
- Share unique-name creation between folder-row and workspace-root actions through one sidebar entry-creation module.
- Consolidate unique-name selection and atomic creation in a workspace-scoped Rust command. Files use `create_new`; folders use exclusive leaf creation. Existing exact-path creation primitives adopt the same non-overwriting semantics.
- Add workspace-scoped Tauri commands for file-manager and terminal launch. Both derive the current window's workspace root instead of accepting an arbitrary frontend path, then validate the snapshot immediately before launch.
- The file-manager command uses the installed Rust opener plugin directly, requiring no broad frontend `open_path` permission.
- Terminal launch avoids shell interpolation: Terminal.app on macOS, a new-console `cmd.exe` inheriting the workspace working directory on Windows, and `$TERMINAL`/known terminal-emulator executable fallbacks inheriting that directory on Linux.

## Validation

- Unit-test native-menu item order, platform labels, workspace/no-workspace variants, and handler routing through the existing pure menu-spec seam.
- Unit-test atomic collision handling, durable empty-folder-tree visibility, and terminal launch specification/target validation in Rust without launching an external application.
- Test the root-creation orchestration order (expand Everything, create, await refresh, then enter rename) through an explicit dependency seam.
- Run `vp check`, `vp test`, `cargo test`, `cargo clippy`, and `cargo fmt --check`.
- Repair the baseline formatting-only failure in `apps/desktop/e2e/specs/visibility-settings.spec.js` so final `vp check` is green.
- Manually verify the native menu and inline rename in the desktop app when the local GUI environment permits it.
