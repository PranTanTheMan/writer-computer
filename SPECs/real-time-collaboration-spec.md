# Real-Time Collaboration Spec

## Status

**Phase 0 complete.** The provider, ownership, persistence, hosting, and invitation
decisions are recorded in the
[Phase 0 decision record](../docs/decisions/real-time-collaboration-phase-0.md).
Phase 1 is the next implementation boundary. No production collaboration behavior
has shipped; the Phase 0 harness and ownership prototype remain test-only.

## Summary

Add optional, local-first real-time collaboration to Writer for selected Markdown
folders. Collaborators can edit the same note concurrently, see each other's
presence, work offline, and converge without replacing local Markdown files with a
proprietary format.

The intended experience is similar to Relay for Obsidian. Writer should either:

1. connect to Relay through an officially supported non-Obsidian integration, if
   System 3 offers a stable client contract; or
2. use a Writer-owned Yjs-compatible collaboration service.

Do not make an unsupported client depend on Relay's proprietary control-plane
endpoints. Relay's MIT-licensed client and server are useful implementation
references, but its Obsidian integration is not a drop-in Writer plugin.

## Research Basis

- [Relay introduction](https://docs.relay.md/introduction/) — shared folders,
  keystroke-level collaboration, live cursors, and offline convergence.
- [Relay hosting architecture](https://docs.relay.md/features/hosting-options/) —
  separates the collaboration server, control plane, and object storage.
- [Relay source](https://github.com/No-Instructions/Relay) — MIT-licensed
  Obsidian client using Yjs, IndexedDB persistence, awareness, CodeMirror 6
  integration, and an explicit disk/CRDT merge state machine.
- [Relay server](https://github.com/No-Instructions/y-sweet) — MIT-licensed fork
  of y-sweet.
- [Relay roadmap](https://relay.md/roadmap) — API access is active work, but the
  public documentation does not yet define a supported third-party live-editing
  client contract.

Writer already has compatible foundations, but its current mutation path is
whole-document oriented:

- `use-prosemark-editor.ts` sends the complete CodeMirror document to the editor
  store after each local transaction.
- `editor-store.ts` marks that buffer dirty and schedules a save.
- `save.ts` serializes and atomically writes the complete Markdown file.
- `use-file-watcher.ts` treats a changed file as an external complete-document
  reload.
- Rust workspace and watcher state is per Tauri window, so same-workspace
  multi-window editing needs an explicit shared-document owner.

## Goals

- Share an explicitly selected workspace folder without sharing the rest of the
  workspace.
- Support concurrent character-level Markdown editing and live collaborator
  selections/cursors.
- Preserve ordinary local `.md` files that remain usable without Writer or the
  collaboration service.
- Support offline editing and deterministic convergence after reconnect.
- Reconcile edits made by Git, scripts, other editors, or another Writer window
  without silently losing either side.
- Keep non-shared files on Writer's existing, low-overhead save path.
- Make collaboration state, connection health, permissions, and conflicts visible
  rather than silently falling back.
- Keep the collaboration transport replaceable behind a narrow provider boundary.

## Non-Goals

- Obsidian Canvas compatibility.
- Comments, suggestions, notifications, or change attribution in the first
  production release.
- Arbitrary binary attachment sync in the Markdown-only MVP.
- End-to-end encryption in the MVP. Transport encryption and encrypted storage are
  required; E2EE needs a separate protocol and threat-model spec.
- Peer-to-peer-only transport. Offline collaborators require an always-on relay.
- Replacing Git or backups with CRDT history.
- Running Relay's Obsidian plugin bundle inside Writer.

## Product Decisions

### Opt-in sharing boundary

Collaboration is folder-scoped. A workspace remains private by default. A file is
collaborative only when it is inside a configured shared folder.

Moving a file across the boundary is an explicit state transition:

- local to shared: create a stable document identity and publish the local text;
- shared to local: materialize the converged text, disconnect the CRDT document,
  and retain the file;
- shared folder removal: never delete local files as an implicit side effect.

### Local file contract

The Markdown file is the durable, interoperable representation. While a file is
shared, its Yjs document is the authoritative merge state and the file is a
materialized projection of that state. Writer must flush a converged projection
before clean shutdown when possible and recover from persisted CRDT state after a
crash.

The shared text model contains the complete serialized Markdown document,
including frontmatter. Frontmatter fields displayed through Writer's structured UI
are derived from and transact against that same text. Do not maintain a second
independently synchronized frontmatter object.

### Stable identity

Network documents use opaque stable IDs, not paths. A folder manifest maps IDs to
relative paths and entry kinds. Renames and moves mutate the manifest without
creating a second document or discarding history.

### Conflicts

Concurrent CRDT edits converge automatically. A true conflict means Writer cannot
safely interpret an external filesystem state, manifest operation, permission
change, or recovery state. Preserve all recoverable versions and show a resolution
surface; never pick a winner silently.

## Architecture

### Collaboration coordinator

Introduce one collaboration coordinator as the only mutation gateway for shared
documents. It owns:

- Yjs document lifetime and offline persistence;
- provider connections and awareness;
- CodeMirror binding and transaction-origin tagging;
- debounced disk projection;
- ingestion of genuine external filesystem edits;
- folder manifest operations;
- connection, permission, and conflict state exposed to the UI.

The existing editor store remains responsible for tabs, navigation, derived
metadata, and non-shared files. Shared files must not pass independently through
both the old autosave path and the collaboration coordinator.

### Provider boundary

Define a small provider interface before choosing a service:

```ts
interface CollaborationProvider {
  connect(documentId: string, token: string): Promise<ProviderSession>;
  disconnect(documentId: string): Promise<void>;
  getStatus(documentId: string): CollaborationStatus;
  refreshCredentials(): Promise<void>;
}
```

`ProviderSession` supplies bidirectional Yjs updates, awareness, reconnect status,
and permission failures. Folder and membership administration belong to a separate
control-plane interface. Editor code must not know whether the provider is Relay,
y-sweet, or a test transport.

### CodeMirror transaction flow

For shared files:

1. Local CodeMirror transactions are converted to Yjs operations.
2. Remote Yjs operations are dispatched into CodeMirror with an explicit remote
   annotation.
3. The ordinary editor update listener ignores remote and document-swap
   transactions when deciding whether to originate another operation.
4. Derived title, stats, search, and syntax state update for both local and remote
   transactions.
5. Undo/redo operates on the local user's CRDT operations and does not undo another
   collaborator's work.

Use a CodeMirror compartment so the collaboration binding can be attached,
reconfigured, or removed without recreating the editor or disturbing Writer's
existing decoration stack.

### Disk projection and external edits

For a shared document, the coordinator serializes the converged Yjs text and uses
Writer's existing atomic Rust write command. Each projection carries a write
identity so watcher echoes are suppressed across windows and delayed events.

A watcher event not matching a known projection is a genuine external edit:

1. read and normalize the file;
2. compare it with the last materialized snapshot;
3. compute and apply a bounded text diff as one external-origin Yjs transaction;
4. persist and publish it;
5. surface an explicit conflict if the file cannot be safely associated with its
   document identity or the diff exceeds safety limits.

File formatting settings such as trimming trailing whitespace must run at a single
defined boundary. They must not continuously generate normalization operations
between peers with different settings.

### Process and multi-window ownership

Exactly one local session owns disk projection for a shared document. Multiple
Writer windows may attach editor views to it, but must not run independent save
controllers for the same path.

The architecture spike must choose one of these implementations based on a working
prototype:

- a process-wide Rust document-session registry with frontend event bridges; or
- one elected frontend owner plus a Tauri-coordinated lease and cross-window
  events.

The choice must survive owner-window closure, workspace switching, sleep/wake, and
two windows opening the same file concurrently. A purely per-window in-memory
owner is not acceptable.

### Local persistence

Persist CRDT updates locally before considering them safely queued. Browser
IndexedDB is acceptable for the spike. Before production, confirm that Tauri
WebView storage survives upgrades and that cleanup, quota errors, corruption, and
workspace deletion have explicit recovery paths. If it cannot meet those
requirements, move persistence behind a Rust-owned store.

### Folder manifest

Text CRDTs do not solve filesystem structure. A shared-folder manifest records:

- stable entry ID;
- parent ID and display name;
- entry kind;
- deletion/tombstone state;
- document ID for Markdown files;
- revision data needed to reject stale structural operations.

Create, rename, move, and delete use one manifest operation path. The local
filesystem is projected from the converged manifest with collision checks and
recoverable tombstones.

### Security boundary

- Tokens are short-lived and scoped to a shared folder or document.
- Long-lived credentials use OS credential storage, not workspace files,
  localStorage, or logs.
- Read-only permissions are enforced by the service and reflected by disabling
  local mutation surfaces; client-only enforcement is insufficient.
- Share invitations never grant access to sibling workspace folders.
- Logs redact document text, tokens, share keys, and user email addresses.

## Delivery Plan

### Phase 0 — provider decision and architecture spike

Deliverables:

- Establish a dated evidence cutoff for an officially supported Relay client
  protocol, hosted service, authentication flow, and brand/product integration.
  Written confirmation from System 3 can satisfy this; public client source alone
  cannot. Record protocol stability, licensing, pricing, support, and
  data-processing constraints. Do not call undocumented proprietary control-plane
  APIs.
- Build a throwaway two-client CodeMirror/Yjs harness using both a deterministic
  transport and the selected concrete local server adapter. The initial
  Writer-owned candidate is self-hosted y-sweet `0.9.1` with
  `@y-sweet/client` `0.9.1`; any different choice must be recorded in the ADR.
- Mount Writer-shaped CodeMirror views in an isolated DOM-capable test environment.
  Prove collaboration-compartment attach/remove/reconfigure, document swap,
  destroy/remount, transaction provenance, awareness cleanup, offline
  state-vector reconciliation, and local-only undo through the editor command
  path.
- Run a deterministic schedule matrix covering overlapping edits, both clients
  offline, both reconnect orders, duplicate/delayed/reordered/dropped updates,
  post-reconnect edits, awareness removal and fresh reconnect publication, and
  selected-provider restart. Timeout-based expiry remains a Phase 1 provider test.
- Add a disposable persistence adapter and prove persist-before-queued semantics,
  client destruction/recreation, recovery, and explicit persistence failure. Make
  and record the IndexedDB-versus-Rust decision.
- Prototype process ownership at the Rust boundary. Prefer a process-owned document
  session to which windows attach; if projection authority can transfer, protect
  the write boundary with monotonically increasing fencing generations. Cover
  simultaneous attachment, stale detach, window destruction, workspace switching,
  delayed writes, sleep/wake, and reacquisition.
- Write an architecture decision record covering provider/protocol/version,
  process ownership, local persistence, initial hosting mode, and production
  invitation model.

Exit gate:

- Two real CodeMirror clients and their Yjs replicas converge under the full
  deterministic schedule matrix and against the concrete local server adapter.
- The selected provider has a documented protocol version, support/licensing path,
  authentication boundary, and upgrade policy.
- Offline edits survive client destruction/recreation, and persistence failure is
  never reported as safely queued.
- The Rust ownership prototype rejects stale and concurrent projection permits at
  the write boundary, not merely in an abstract owner model.
- All five architecture decisions at the end of this spec are resolved in the ADR.
- No production UI or migration is merged from the throwaway harness.

### Phase 1 — shared-document core behind a feature flag

Deliverables:

- Add the collaboration coordinator and provider interface.
- Bind one open Markdown file to Yjs through a CodeMirror compartment.
- Add origin annotations and local-user undo semantics.
- Add offline persistence and deterministic reconnect.
- Expose minimal connection/error state for diagnostics.
- Keep the existing save path unchanged for non-shared files.

Exit gate:

- Automated tests cover two clients performing inserts, deletes, overlapping
  edits, undo, reconnect, and provider denial.
- Editor decorations, search, document stats, frontmatter, tab switching, and
  history continue to work after remote changes.

### Phase 2 — disk and watcher convergence

Deliverables:

- Make the coordinator the only disk writer for shared files.
- Add cross-window write identities and owner failover.
- Translate external disk changes into Yjs transactions.
- Add crash recovery and a conflict-preserving recovery surface.
- Add diagnostics for state transitions before attempting alternative merge logic
  after a failed fix.

Exit gate:

- No echo loops or lost edits under editor, remote, Git/script, and second-window
  changes.
- Killing Writer during queued, networked, and disk-projection states recovers to
  a converged document.

### Phase 3 — shared-folder structure

Deliverables:

- Implement the stable-ID folder manifest.
- Integrate create, rename, move, and delete with the existing sidebar write path.
- Add shared-folder selection and clear shared/private boundary indicators.
- Handle case-only renames, path collisions, invalid platform names, and moves
  across the sharing boundary.

Exit gate:

- Two clients converge on both contents and folder structure after concurrent
  structural operations and offline reconnect.
- Local files are retained when a folder is unshared or a user leaves.

### Phase 4 — identity, invitations, and permissions

Deliverables depend on the Phase 0 provider decision:

- Relay-supported: integrate only documented authentication, invitation, and
  administration contracts.
- Writer-owned: implement a minimal control plane for accounts, folder membership,
  invitations, token issuance, revocation, and audit events.

Exit gate:

- Revoked and read-only clients are rejected server-side.
- Joining exposes only explicitly shared folders.
- Credentials remain outside workspaces and diagnostic exports.

### Phase 5 — product hardening and Markdown-only release

Deliverables:

- Collaboration settings and shared-folder management UI.
- Presence avatars/cursors, offline/read-only/conflict indicators, and accessible
  status text.
- Load, soak, sleep/wake, network partition, storage quota, and upgrade tests.
- Backup/restore documentation and operational runbooks.
- Telemetry limited to opt-in operational metadata with no document contents.

Exit gate:

- All acceptance criteria pass on macOS, Windows, and Linux.
- A staged rollout can disable new sharing without making existing local files
  unavailable.

### Phase 6 — attachments and later collaboration features

Specify separately after the Markdown-only release. Candidate work includes blob
storage, comments, notifications, attribution, web access, and E2EE. None should
expand the core text protocol implicitly.

## Expected Code Areas

- `apps/desktop/src/components/editor-area/use-prosemark-editor.ts` — attach the
  shared-document CodeMirror compartment and origin-aware listeners.
- `apps/desktop/src/stores/editor-store.ts` — consume shared snapshots and derived
  state without owning shared-file persistence.
- `apps/desktop/src/lib/save.ts` — bypass/delegate shared-file saves through the
  coordinator while retaining the existing non-shared path.
- `apps/desktop/src/hooks/use-file-watcher.ts` — route genuine shared-file changes
  to external-edit ingestion.
- new `apps/desktop/src/collaboration/` — document coordinator, provider boundary,
  awareness, persistence, and manifest client.
- `apps/desktop/src-tauri/src/state.rs` — process-wide shared-document ownership or
  lease state.
- `apps/desktop/src-tauri/src/commands/fs.rs` and watcher modules — write identities,
  projection, and external-change coordination.
- settings schema and shared-folder UI after the core pipeline is proven.

The exact file list after Phase 0 must follow Writer's consolidation rule: adding a
new shared-document mutation source should extend one coordinator rather than add
branches independently to the editor, store, save engine, and watcher.

## Validation Strategy

### Deterministic model tests

- Two or more simulated clients with deterministic message ordering.
- Concurrent insert/delete/replace at the same and adjacent positions.
- Duplicate, delayed, reordered, and dropped messages.
- Offline edits on every client followed by reconnect.
- Local-only undo/redo.
- Provider token expiry and permission downgrade.
- Rename/delete/move races once the manifest exists.

### Writer integration tests

- Real CodeMirror views; assert transaction annotations and final document state.
- Remote edits update syntax decorations, search, titles, frontmatter, and stats.
- Tab swaps do not retain the previous document's provider or awareness.
- Non-shared files retain current save behavior.
- Two Writer windows cannot both project the same shared document.
- Watcher echoes are suppressed while genuine external writes are ingested.

### End-to-end and resilience tests

- Two packaged app instances against a local collaboration server.
- Network partition/reconnect and server restart.
- App crash between local edit, persistence, publish, and disk projection.
- Sleep/wake and clock changes.
- Large documents, long offline histories, and slow/network-mounted workspaces.
- Repeated rename/move/delete while one client is offline.

Run the normal `vp check`, `vp test`, Rust test/clippy/format suite, and targeted
packaged-app E2E scenarios for every implementation phase.

## Risks and Mitigations

- **Unsupported Relay coupling:** require an official integration contract or use a
  Writer-owned provider.
- **Two sources of truth:** one coordinator owns shared mutations; disk is a
  projection while sharing is active.
- **Save/watcher feedback loops:** origin annotations and cross-window write
  identities are first-class protocol data, not timing heuristics.
- **External-edit ambiguity:** preserve versions and surface conflicts rather than
  replacing CRDT state wholesale.
- **Multi-window races:** process-wide ownership or a renewable lease with tested
  failover.
- **Unbounded CRDT growth:** define compaction/snapshot policy and test long-lived
  documents before release.
- **Local storage loss/quota:** explicit health reporting, export/recovery paths,
  and no false “synced” state before durable persistence.
- **Path collisions and platform differences:** stable IDs plus normalized,
  validated manifest projection.
- **Server operational burden:** start with a single documented deployment target,
  backups, health checks, and protocol-version compatibility policy.

## Acceptance Criteria

- A user can share one folder without exposing the rest of the workspace.
- Two users can concurrently edit the same Markdown file and see live selections.
- Each user can edit offline and all replicas converge after reconnect.
- Shared files remain ordinary readable Markdown on disk.
- Git/script/other-editor changes enter the shared document without silent data
  loss or feedback loops.
- Renames, moves, creates, and deletes converge across clients.
- Read-only and revoked access is enforced by the service.
- Closing a window, switching workspaces, crashing, or restarting the server does
  not create duplicate writers or discard acknowledged local edits.
- Non-shared Writer workspaces incur no collaboration connection, persistence, or
  save-path overhead.
- Provider-specific code is isolated behind the collaboration and control-plane
  interfaces.

## Decisions Required at the Phase 0 Gate

Resolved in the
[Phase 0 decision record](../docs/decisions/real-time-collaboration-phase-0.md):

1. Writer-owned provider boundary, initially y-sweet `0.9.1`; no unsupported
   Relay compatibility claim.
2. Process-wide Rust session registry with fenced projection permits.
3. IndexedDB for Phase 1, gated by packaged-WebView durability tests before
   production; Rust-owned persistence remains the fallback.
4. Self-hosting first; a Writer-hosted service is deferred.
5. Account-based, revocable invitations for production; development tokens stay
   local and feature-flagged.
