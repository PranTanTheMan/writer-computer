# Worksheet: PR #111 Review Fixes

## References

- Review fixed point: `origin/master` / merge-base `eef8455`
- Specs: [`../sidebar-empty-area-context-menu-spec.md`](../sidebar-empty-area-context-menu-spec.md), [`../configurable-default-terminal-spec.md`](../configurable-default-terminal-spec.md)
- PR: #111

## Reviewed

- `AGENTS.md`; `docs/workflows/agent-loop.md`; `docs/workflows/agent-review.md`
- `docs/consolidation.md`; `docs/react-guidelines.md`; `docs/zustand.md`
- Rust workspace state, sidebar creation, file-manager/terminal launch, settings persistence, app/sidebar layout, surface-menu routing, and focused tests

## Baseline

- Clean branch tracking the open PR branch at `3cc11a0`.
- Prior final validation: `vp check` passed with one existing warning; 38 frontend files / 545 tests and 142 Rust tests passed; clippy and formatting passed with existing warnings only.

## Plan

1. Add a guarded workspace-snapshot execution primitive that keeps the root read lock across a sensitive synchronous operation. Use it around each exclusive sidebar-entry create attempt, validated file-manager launch, and each terminal process spawn; stale root/epoch operations must fail before their side-effect callbacks run. Release the guard before waiting for macOS `open` status.
2. Add an `AppState` global-settings write lock. Inside it, fallibly reload the latest global config before every set/reset so independently hydrated windows merge one mutation instead of rewriting a stale snapshot. Treat `NotFound` as empty and propagate every other read error without changing memory or disk. Initialize/migrate per-window settings under the same lock and make construction failures explicit.
3. Replace parallel platform label switches with one typed label registry.
4. Move sidebar-surface menu ownership from `FileBrowser` to a generation-keyed outer sidebar surface, lifting rename/collapse state with it. Attach context-menu routing to the outer boundary while row menus retain propagation stops, and start the layout's global drag overlay after the expanded sidebar so its own top drag region receives the event.
5. Render the normal workspace layout for rootless non-compact windows, showing `WelcomeScreen` in the editor region and keeping the sidebar/no-workspace toggle menu reachable. Compact-file behavior remains unchanged. Drive the three root/chrome combinations through a pure view-routing seam.
6. Validate through red→green tests at the settings two-instance seam, guarded Rust side-effect seams, platform-label seam, menu-state seam, and available app/layout integration seams. Run full gates, desktop smoke, independent review, docs/changelog, one commit, and push to PR #111.

## Risks / Edge Cases

- Workspace switching must not block on long work; hold the root read guard only across one exclusive create or immediate opener/process-spawn call, never while waiting for macOS launcher status.
- Collision retries must re-check the captured workspace before every candidate.
- Global lock order is app-level global-config lock before a window settings write lock; no reverse acquisition is allowed.
- Rootless standard windows show the sidebar; compact-file windows must not regress into workspace chrome.
- Moving menu ownership must reset transient rename/collapse state on workspace generation changes and preserve row/bulk menu propagation.

## Test Seams

- Rust `Settings` instances sharing one config directory for lost-update regression.
- Guarded callback helpers proving stale creation/file-manager/terminal callbacks never execute and `try_write` fails while a side-effect callback is active.
- Fallible settings load/reload tests plus shared-lock concurrency coverage for mutation and initialization/migration.
- Pure platform label registry and sidebar menu specs.
- Pure root/chrome app-view routing assertions. Native menu smoke covers top/content/bottom surface zones, row/bulk propagation, rootless visibility-only actions, compact sidebar absence, and A→B plus same-root/ABA transient-state reset where DOM infrastructure is unavailable.

## Implementation

- Added one `WorkspaceState::with_workspace_snapshot` boundary that holds the root read guard through a single side effect. Sidebar entry creation uses it for every collision attempt; file-manager open and each terminal spawn use it after live filesystem validation. macOS launcher status waits happen after the guard is released.
- Added an awaited backend close transition that increments the epoch, clears the root and workspace-owned state atomically, and rejects a stale expected root before the frontend clears. This closes the A→no-workspace stale-action case.
- Routed open and close through one workspace-runtime reset funnel. Bootstrap indexing, explicit indexing, ignore rebuilds, and queued watcher batches retain a validated root snapshot through their final state writes, so stale background publishers cannot repopulate a closed workspace.
- Made global settings construction/reload fallible, with `NotFound` mapped to an empty layer and all other read failures propagated before mutation. Global set/reset reload from disk and only publish the in-memory snapshot after a successful write.
- Added the process-wide global-settings mutex and enforced `global lock → window settings lock` for initialization/migrations and global mutations.
- Consolidated platform menu labels into one typed registry.
- Moved surface menu and rename/collapse state into a full sidebar subtree keyed by workspace generation. The outer surface owns top/content/bottom routing; the workspace drag overlay begins at the live sidebar width.
- Added a pure app-view resolver. Rootless standard windows now render the workspace shell with welcome content, while compact-file windows remain sidebar-free.

## Red → Green / Focused Validation

- Reproduced the lost-update bug with two stale `Settings` instances: the second write erased `workspace.default-terminal`; the test passes after latest-disk merge semantics.
- Added settings read-error/missing-file coverage and deterministic shared-lock coverage proving initialization waits behind a global mutation.
- Added stale/ABA workspace and guard-duration coverage for creation, file-manager, and terminal side-effect seams.
- Added root/chrome view routing tests; existing menu-label and surface-menu suites cover the typed registry and rootless visibility-only menu spec.
- Focused and full tests pass: 40 frontend files / 552 tests and 153 Rust tests. Workspace watcher notifications carry their originating root/epoch identity and stale A→B, A→none, and same-root/ABA payloads are rejected by the frontend; a shared cross-language fixture enforces the serialized identity contract, and revision-checked index publication rejects stale prepared results. `vp check` passes with the existing `wdio.conf.js` warning only.
- Desktop development startup smoke reached the running Tauri app. The native E2E sweep was attempted, but its release bundle stops before compilation on the pre-existing Tauri JS/Rust version mismatch (`tauri` 2.11.2 vs API 2.10.1; dialog 2.7.1 vs 2.6.0). The new E2E geometry check therefore remains source-reviewed rather than locally executed.

## Review

- Plan review passed after tightening fallible config reads, guarded terminal spawning, global-lock concurrency coverage, and titlebar hit routing.
- Fresh Rust/Tauri, React/UX, and QA implementation reviews passed after fixes for replaced-root creation containment, the pointer-capturing toggle overlay, rootless tab chrome, focused selectors, and rooted E2E setup.
- The final two-axis review found and closed A→no-workspace backend invalidation and stale background publishing, moved sidebar orchestration behind a co-located hook, derived frontend setting metadata from the JSON source, enforced the shared sidebar-entry-kind contract, centralized close feedback, and consolidated platform launch selection.
