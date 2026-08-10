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

## Follow-up: Folder Row Open in Terminal

### Baseline

- Clean branch tracking the open PR branch.
- `vp install`, `vp check`, and `vp test`: passed; 37 files / 540 tests, with the existing non-failing `wdio.conf.js` warning.
- Rust: 136 tests passed; clippy completed with existing warnings; formatting passed.

### Plan

1. Extend the pure folder-menu spec with **Open in Terminal** immediately before Reveal in the same group, plus exact order and handler routing coverage.
2. Keep one terminal IPC, adding an optional directory. Capture the invoking window's state/root/epoch; canonicalize off-thread; require the target to be the root or descendant; then revalidate the live root, epoch, and unchanged canonical root immediately before launch. Files, missing paths, siblings, replaced roots, external symlinks, A→B switches, and same-root/ABA reopen cycles are rejected; internal symlinks are accepted.
3. Route both the sidebar surface and folder row through one testable frontend helper that forwards `null` or the selected `entry.path` and owns the exact `Failed to open terminal: …` alert prefix.
4. Cover the pure folder-menu seam, selected-path/error helper, exact IPC null/path forwarding, and Rust target/snapshot validation, then run the full frontend/Rust gates and independent UX/QA plus Rust/architecture reviews.
5. Update the changelog/task state, commit one follow-up change, and push it to the existing PR.

### Risks / Edge Cases

- A stale or malicious frontend path must not launch a terminal outside the invoking window's workspace.
- Canonical containment must reject symlinks that resolve outside the workspace while accepting nested directories and the root itself.
- Folder row errors should use the same neutral, actionable terminal failure message as the sidebar surface.
- Native menu selection and actual terminal working directories require a manual desktop check; unit tests cover construction, routing, and rejection behavior without launching external apps.

### Plan Review

- UX/QA required explicit menu placement, a selected-row path wiring seam, and single-owned frontend error presentation. The revised plan places Terminal immediately before Reveal, introduces a shared helper, and tests exact path/error routing.
- Rust/architecture required root plus epoch revalidation across the blocking boundary, including same-root ABA and replaced-root symlink cases. The revised plan captures per-window state/root/epoch and revalidates all three immediately before process creation.

### Implementation Result

- Added **Open in Terminal** immediately before Reveal in folder row menus and bound it to the selected `DirEntry.path` through a focused, testable action seam.
- Routed root and folder actions through one frontend error owner and the existing terminal IPC, now with an explicit optional path argument.
- Added atomic workspace root/epoch publication and snapshot methods. The backend canonicalizes the selected directory, rejects paths outside the invoking workspace, and revalidates live root, epoch, requested path, and canonical target immediately before every process attempt.
- Covered missing/files/siblings, internal and external symlinks, root replacement, delayed target replacement, A→B switching, and same-root/ABA epochs.

### Review and Validation

- Independent UX/QA and Rust/architecture plan reviews passed after tightening menu order, wiring coverage, and stale-launch requirements.
- Independent standards and spec implementation reviews passed after closing non-atomic root/epoch capture, delayed selected-target replacement, and folder-row wiring gaps.
- `vp check`: passed with the existing non-failing `wdio.conf.js` warning.
- `vp test`: 38 files / 545 tests passed.
- Rust: 142 tests passed; `cargo clippy` and `cargo fmt --check` passed with only pre-existing warnings.
- `vp run desktop#dev`: compiled, launched, and remained stable until intentionally stopped. Native menu selection and the external terminal working directory were not automated.
