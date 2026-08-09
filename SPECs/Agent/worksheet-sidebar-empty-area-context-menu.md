# Worksheet: Sidebar Empty-Area Context Menu

## References

- TODO: Sidebar empty-area workspace actions
- Spec: [`../sidebar-empty-area-context-menu-spec.md`](../sidebar-empty-area-context-menu-spec.md)

## Reviewed

- `TODOS.md`; `docs/workflows/agent-loop.md`; `docs/workflows/agent-review.md`
- `docs/react-guidelines.md`; `docs/zustand.md`; `docs/consolidation.md`
- Sidebar surface, navigator, tree, row context-menu, filesystem IPC, and existing menu tests
- The pre-existing Reveal-in-sidebar task is already marked In Progress, but this worktree started clean and contains no local implementation for it; this user-requested task is being kept separate.

## Baseline

- `vp install`: passed.
- `vp test`: 36 files / 522 tests passed.
- Rust tests: 123 passed; clippy completed with existing warnings; formatting passed.
- `vp check`: existing formatting failure in `apps/desktop/e2e/specs/visibility-settings.spec.js` before this task.

## Plan

1. Extend the pure sidebar-surface menu spec with workspace actions, separators, platform-specific file-manager labels, and optional workspace state.
2. Move unique-name selection and exclusive create/retry into one workspace-scoped Rust command, and make the exact-path create primitives atomic too.
3. Make visible empty directory trees a durable part of Everything's Markdown-focused visibility rule; control Everything's collapsed state so creation can expose inline rename.
4. Lift the transient rename target to `FileBrowser`, then run root creation through an explicit orchestration seam: expand, create, await refresh, rename.
5. Add workspace-scoped backend commands for opening the current window's root in the file manager and platform terminal; accept no arbitrary frontend path and avoid shell interpolation.
6. Add focused TypeScript and Rust coverage, repair the baseline formatting-only failure, validate, run the required independent implementation review, and address findings.
7. Update the changelog and task tracker, then commit this task alone.

## Risks / Edge Cases

- Row menus must continue stopping propagation so surface actions never replace file/folder actions.
- Root refresh must finish before rename state is set or the input will not mount; Everything must also be expanded.
- External application launch errors must be surfaced rather than swallowed.
- Terminal launch behavior differs by platform; avoid shell interpolation of workspace paths.
- Empty folder visibility must be durable without exposing directories that contain only non-Markdown files.
- Candidate selection and creation must be one atomic retry loop so a concurrent creator cannot be overwritten.

## Plan Review

- UX, Rust/Tauri/Systems, and React/QA reviewers all blocked the first draft because empty folders were filtered before rename and the proposed frontend opener call lacked permission.
- Rust review also identified a pre-existing check-then-create overwrite race, stale arbitrary-path launch ownership, and underspecified platform launch construction.
- The revised plan resolves these at the Rust/workspace boundaries, controls Everything expansion, and adds orchestration and collision coverage.

## Implementation Result

- Extended the native surface menu with root creation and workspace launch actions while preserving the Search/Recents checks and row-menu propagation boundary.
- Added one workspace-scoped, atomic `create_sidebar_entry` path shared by root and folder-row creation. Exact-path file/folder creation is also exclusive, collision retry is unbounded/checked, and canonical parent containment prevents writes outside the invoking window's workspace.
- Kept empty folder-only trees visible without exposing directories containing visible non-Markdown files. The indexed path retains its Markdown O(1) fast path and stops at the first visible non-Markdown file when checking emptiness.
- Unified expand/create/refresh/rename sequencing, including cached collapsed folders, and generation-scoped all async UI/cache effects so workspace switches and same-root reopen cycles cannot apply stale results. Sidebar transient state remounts per workspace generation.
- Added workspace-scoped file-manager and terminal launch commands with shell-free platform mappings; no broad frontend opener permission was added.
- Fixed the baseline-only formatting issue in `apps/desktop/e2e/specs/visibility-settings.spec.js`.

## Review and Validation

- Plan review: initial UX, Rust/Tauri/Systems, and React/QA blockers were addressed; all reviewers approved the revised plan.
- Implementation review: fixed indexed non-Markdown scan performance, cached collapsed-folder refresh, workspace ABA races, rename-input context routing, and the artificial 999-name ceiling. The final two-axis audit additionally tightened controlled sidebar props, consolidated workspace identity/generation transitions, and made directory-walk errors explicit instead of silently skipping them.
- `vp check`: passed; one pre-existing non-failing `wdio.conf.js` JSDoc warning remains.
- `vp test`: 37 files / 536 tests passed after the final lifecycle changes.
- `cargo test`: 131 tests passed. `cargo clippy` and `cargo fmt --check` passed; clippy reports only pre-existing warnings.
- `vp run desktop#dev`: compiled, launched the Tauri app, and remained stable until intentionally stopped. Native menu selection and external Terminal/Finder launch were not automated; platform command construction and error paths are covered by focused tests.
