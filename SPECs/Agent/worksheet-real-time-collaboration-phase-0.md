# Real-Time Collaboration Phase 0 Worksheet

## Task

- TODO: `Real-time collaboration` in `TODOS.md`
- Spec: [`../real-time-collaboration-spec.md`](../real-time-collaboration-spec.md)
- Scope for this task: Phase 0 only — provider decision, disposable two-client
  CodeMirror/Yjs convergence harness, and local single-owner architecture proof.

## Workspace State

- The pre-existing `Reveal-in-sidebar + residual external-watcher misses` task is
  already in progress and is unrelated. Do not edit or absorb it.
- The collaboration planning spec was committed separately as `c150c0f` before
  Phase 0 implementation began.

## Docs and Code Reviewed

- `AGENTS.md`
- `docs/workflows/agent-loop.md`
- `docs/editor.md`
- `docs/consolidation.md`
- `SPECs/real-time-collaboration-spec.md`
- `SPECs/multi-window-spec.md`
- `apps/desktop/src/components/editor-area/use-prosemark-editor.ts`
- `apps/desktop/src/stores/editor-store.ts`
- `apps/desktop/src/lib/save.ts`
- `apps/desktop/src/hooks/use-file-watcher.ts`
- `apps/desktop/src-tauri/src/state.rs`
- Relay public documentation and the MIT-licensed Relay client/server source

## Investigation Summary

- Writer and Relay both use CodeMirror 6, and Relay uses Yjs for CRDT text and
  awareness.
- Relay's client is heavily coupled to Obsidian APIs; its public code is a useful
  reference but not a drop-in dependency.
- Relay's collaboration server is open source, but its authentication,
  permissions, and billing control plane is proprietary. There is no documented
  supported third-party live-editor client contract as of the research date.
- Writer currently has independent whole-document editor, save, and watcher paths.
  Production collaboration will require a single shared-document coordinator, but
  Phase 0 must not modify those production paths.
- Writer's Tauri workspace state is per window. Phase 0 must prove a design that
  cannot elect two disk writers for the same shared document.

## Plan

1. Run dependency installation and the baseline frontend/Rust validation suite.
2. Add an isolated DOM-capable Vitest environment for the spike without changing
   the environment used by the existing suite. Mount and destroy two real
   `EditorView` instances.
3. Define the provider boundary once, then run the collaboration harness through:
   - a deterministic in-memory transport whose scheduler can hold, reorder,
     duplicate, and drop encoded Yjs updates; and
   - a real local y-sweet `0.9.1` server through `@y-sweet/client` `0.9.1`.
4. Make reconnect use Yjs state-vector reconciliation, not buffered replay. Cover
   overlapping insert/delete/replace, both clients editing offline, both reconnect
   orders, duplicate/delayed/reordered delivery, post-reconnect edits, and a local
   server restart.
5. Use Writer's real `prosemarkBasicSetup` in the mounted views and a collaboration
   compartment. Assert attach, reconfigure, remove, path/document swap, reload,
   destroy, and remount cleanup. An old document/provider/awareness instance must
   be unable to mutate the reconfigured view.
6. Make transaction provenance executable:
   - one local CodeMirror edit creates one local-origin Yjs transaction/outbound
     update;
   - a remote update carries a remote CodeMirror annotation, updates derived
     listeners, and creates neither an outbound echo nor a normal save-origin
     callback; and
   - switching documents switches the undo manager.
7. Disable native CodeMirror history for shared documents in the production design
   and give the collaboration binding precedence for undo/redo. In the harness,
   invoke the collaboration-enabled CodeMirror command path after interleaved
   A/B/A edits and prove undo/redo affects only the invoking user's operations.
8. Use real Yjs awareness with relative selection positions. Assert cursor remapping
   after preceding edits and removal on disconnect, document swap, and destroy;
   reconnect publishes fresh presence instead of replaying it.
9. Add disposable durable persistence using `y-indexeddb`. Prove an offline update
   reaches the persistence completion point, destroy/recreate the client while
   offline, then converge. A rejected/quota-like persistence write must not be
   reported as safely queued. Record IndexedDB as the Phase 1 choice, gated on a
   packaged-Tauri WebView persistence check before production release.
10. Prototype the actual ownership boundary as a Rust process-wide session registry
    with independent uniqueness constraints for stable document ID and canonical
    projection path. A reverse path index prevents two document IDs from owning the
    same file, while atomic path rebinding prevents one document ID from retaining
    two projection paths. The process owns projection; windows attach as views.
    Projection permits carry monotonically increasing fencing generations validated
    at the write boundary. Test simultaneous attach, same-path/different-ID and
    same-ID/different-path collisions, atomic path rebinding, stale detach, window
    destruction, workspace switch, delayed writes after reassignment,
    monotonic-clock-independent sleep/wake, idempotent release, and reacquisition.
11. Record all five Phase 0 decisions in an ADR:
    - `writer-owned`, with self-hostable y-sweet `0.9.1` as the initial concrete
      protocol/server and a pinned compatibility policy;
    - Rust process-wide session registry;
    - IndexedDB CRDT persistence for Phase 1, subject to the packaged-WebView gate;
    - self-hosting first, with a Writer-hosted deployment deferred; and
    - account-based invitations for production, with development tokens only in
      the feature-flagged core.

    Public Relay documentation and source are the evidence cutoff for this task:
    as of 2026-08-18 they publish no supported third-party live-editor contract.
    Written System 3 confirmation can reopen the provider ADR later; Phase 0 will
    not call undocumented proprietary APIs or claim Relay compatibility.

12. Update the spec/TODO/worksheet, run full validation, and commit Phase 0 only.

## Plan Review

Initial review was blocked by three independent reviewers. The plan above addresses
their P1 findings:

- **Editor:** generic views did not prove Writer lifecycle behavior; provenance and
  undo were not asserted across both CodeMirror and Yjs.
- **Systems:** the provider was not concrete, the ownership proof was not at the
  actual Rust boundary or fenced, and persistence/hosting/invitation decisions were
  missing from the ADR.
- **QA:** the runner had no DOM environment, the transport did not create genuine
  concurrency, offline edits were not durable, and awareness/undo assertions were
  underspecified.

The revised plan requires Writer-shaped views, two provider adapters, durable
client recreation, real awareness, an adversarial delivery matrix, and a fenced
Rust registry before Phase 0 can pass.

## Risks / Edge Cases

- A test-only harness can accidentally imply production architecture. Keep its
  modules isolated and label them disposable.
- Yjs undo must track only the local client's transaction origin.
- Offline reconnect tests must cover concurrent edits on both clients, not only
  sequential replay.
- Awareness is ephemeral and must not be mistaken for durable document state.
- Lease expiration alone can briefly produce split-brain ownership. Prefer a
  process-wide registry if it can own all Writer windows in the current Tauri
  process.
- The provider decision cannot claim Relay compatibility without an official
  contract.
- A process-wide registry does not protect concurrent independent Writer processes.
  Phase 0 assumes the existing single-instance plugin enforces one app process;
  the ADR must state that fault-model boundary.
- Headless DOM tests do not cover WebView IME, composition, or layout timing. Keep
  these as explicit Phase 1 packaged-app gaps.

## Implementation and Results

- Added a disposable happy-dom CodeMirror/Yjs harness using Writer's real
  `prosemarkBasicSetup`, a collaboration compartment, Yjs undo, awareness, and
  transaction provenance metrics.
- Added a deterministic Yjs transport with state-vector reconnect and controllable
  held, reversed, duplicated, and dropped delivery. Tests cover both reconnect
  orders, overlapping offline changes, post-reconnect edits, local-only undo/redo,
  relative cursor remapping, stale-presence removal, reload, document swap,
  destroy, and remount.
- Added an IndexedDB-gated provider whose outbound update waits for the Yjs update
  transaction's durability checkpoint. A mounted editor is destroyed and fully
  recreated while offline before convergence; a real closed-database checkpoint
  error publishes and acknowledges nothing.
- Added a real local y-sweet `0.9.1` fixture and `@y-sweet/client` adapter. The test
  observes a filesystem checkpoint, restarts on the same store, verifies the
  checkpoint through a fresh client before reconnecting the offline editors, then
  converges and propagates a post-restart edit. The adapter removes remote
  awareness on disconnect, preserves the desired local user/cursor payload, and
  republishes it for the same mounted client after direct reconnect and restart.
- Added a disposable Rust integration prototype for a process-wide session
  registry. Stable document IDs and Rust-canonicalized paths have independent
  uniqueness constraints; one unique view attachment owns projection and all other
  views are denied permits and rebind authority. Projection generations are
  validated while authority remains held through a real temp-file write. Tests
  cover competing threads, atomic owner-authorized rebinding versus an in-flight
  write, owner handoff, multiple views in one window, stale detach/write,
  idempotent release, window cleanup, sleep without time leases, and fenced
  reacquisition.
- Recorded all five decisions in
  [`../../docs/decisions/real-time-collaboration-phase-0.md`](../../docs/decisions/real-time-collaboration-phase-0.md):
  Writer-owned y-sweet boundary, Rust process ownership, conditional IndexedDB,
  self-hosting first, and account-based invitations.
- No production save, watcher, IPC, UI, or default editor behavior changed. The
  only production-source change adds an opt-in history-free
  `prosemarkBasicSetup({ history: false })` mode; existing callers retain native
  history. All collaboration runtime dependencies remain test-only dev
  dependencies.

Targeted validation:

- `vp check` passes with the one pre-existing `wdio.conf.js` warning.
- Both collaboration frontend test files pass: 8 tests.
- `cargo test --test realtime_collaboration_ownership_spike`: 6 tests pass.

Implementation review:

- Editor Expert: approved after native-history omission, empty-stack command
  consumption, transaction origins, swap-scoped undo, and same-session y-sweet
  presence republication were made executable.
- Systems Architect: approved after rebind authority was restricted to the current
  projection-owner attachment and tested alongside real-file commit fencing.
- QA: approved the adversarial schedule, loss-sensitive assertions, mounted
  persistence recreation/failure, real checkpoint reload, and teardown evidence.

Full validation:

- `vp check`: passes with the one pre-existing `wdio.conf.js` warning.
- `vp test`: 42 files and 560 tests pass.
- `cargo test`: 153 unit tests and 6 Phase 0 integration tests pass.
- `cargo clippy --all-targets --all-features`: passes with pre-existing warnings.
- `cargo fmt --check`: passes.
- `git diff --check`: passes.
