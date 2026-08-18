# Real-Time Collaboration Phase 0 Decision Record

- **Status:** Accepted for Phase 1
- **Date:** 2026-08-18
- **Scope:** Provider, local ownership, offline persistence, hosting, and invitations
- **Spec:** [`../../SPECs/real-time-collaboration-spec.md`](../../SPECs/real-time-collaboration-spec.md)

## Context

Writer needs optional real-time collaboration without giving up its local Markdown
contract. Relay demonstrates the intended product experience and shares useful
MIT-licensed implementation patterns, but its Obsidian client is not a reusable
Writer integration.

The evidence cutoff for the provider decision is 2026-08-18. At that cutoff,
Relay's public documentation and source do not publish a supported third-party
live-editor contract covering its hosted protocol, authentication/control plane,
pricing, support, brand use, or data processing. Public source availability is
not treated as permission to call undocumented hosted endpoints. Written System 3
confirmation of a supported contract can reopen this decision.

Phase 0 mounted two real Writer-shaped CodeMirror views over Yjs and exercised
them through both a deterministic adversarial transport and a local y-sweet
server. It also tested IndexedDB recreation and a Rust process-owned projection
registry. The harness and registry are disposable test code; no production save,
watcher, editor, or UI behavior changed.

## Decisions

### 1. Writer-owned provider protocol

Phase 1 will use a Writer-owned provider boundary backed initially by self-hosted
y-sweet `0.9.1`, `@y-sweet/client` `0.9.1`, Yjs `13.6.32`, and
`y-codemirror.next` `0.3.6`. Writer does not claim Relay compatibility and will
not call Relay's undocumented proprietary control plane.

The compatibility contract is the pinned client/server package set plus the Yjs
document-update and awareness behavior covered by Writer's provider tests. There
is no separate wire-protocol version in the selected public API. Upgrades must:

1. change the client and server pins together in one task;
2. pass deterministic convergence, offline recreation, awareness, undo, and
   real-server restart tests against both old persisted state and the candidate
   version; and
3. document any migration or rollback restriction before release.

y-sweet and the selected JavaScript packages are MIT-licensed and community
supported, with no support SLA accepted by Writer. Writer owns product support and
compatibility testing. The initial deployment has infrastructure cost only; no
third-party hosted pricing or data-processing agreement is assumed.

Authentication has two distinct boundaries. The collaboration provider consumes
short-lived document-scoped client tokens. A separate Writer control plane will
authenticate accounts, authorize folder membership, and mint those tokens. The
y-sweet no-auth development mode and direct test tokens are allowed only in local,
feature-flagged development fixtures and cannot be a production path.
Phase 0 proves the y-sweet transport/session boundary only; token expiry, refresh,
denial, and permission downgrade remain required Phase 1 provider tests before the
development feature can be enabled.

### 2. Rust process-wide document-session registry

The Tauri process owns local projection authority for each logical shared-document
session. Each WebView may hold its own synchronized Yjs replica, but it attaches to
the Rust registry with a unique attachment ID; exactly one attachment is the
projection owner. Non-owner attachments cannot mint projection permits. On owner
closure the registry selects a surviving attachment, advances the projection
generation, and publishes the ownership change before that attachment may write.

The registry independently enforces uniqueness of both stable document ID and a
Rust-canonicalized projection path, with a reverse path index and atomic path
rebinding. Rebinding requires the current projection-owner attachment; a non-owner
view cannot invalidate the owner's permit or mint authority for a new path. Window
labels are not attachment identities; a window-incarnation ID allows multiple
views in one window and prevents delayed cleanup from an older window instance
affecting a new one. Production IPC must derive attachment and window-incarnation
identity from trusted Tauri context rather than accepting either from the WebView.

Every projection permit contains the document ID, canonical path, owner attachment
ID, and a monotonically increasing generation. The Rust write boundary validates
all four and retains authority through the filesystem commit; production may use
a per-session writer queue instead, but cannot split validation from commit.
Rebind, owner transfer, final release, and reacquisition invalidate old projection
generations without invalidating live view attachments. Ownership has no
wall-clock lease and therefore does not expire because of sleep, wake, or clock
adjustment.

This decision's fault model is one Writer app process. Writer already registers
Tauri's single-instance plugin so normal second launches route into the running
process. Phase 2 must verify this on every supported platform and add a cross-
process file lock or equivalent before release if independent processes can bypass
that boundary. A process-local registry alone does not prevent split brain across
two independently running binaries.

### 3. IndexedDB persistence for the Phase 1 core

Phase 1 will persist Yjs state in IndexedDB before reporting an offline change as
safely queued. A failed transaction, quota error, unavailable database, or
corruption signal must produce an explicit unhealthy state and cannot advance the
durability checkpoint.

This is conditional, not a permanent storage commitment. Before production,
packaged Tauri tests must show that WebView storage survives restart and app
upgrade on macOS, Windows, and Linux, and must cover cleanup, workspace removal,
quota exhaustion, and corruption/export recovery. If that gate fails, persistence
moves behind a Rust-owned store without changing the provider or editor boundary.

### 4. Self-hosting first

The first supported deployment target is a documented self-hosted y-sweet
instance. A Writer-hosted service is deferred until its control plane, operations,
pricing, privacy terms, regional storage, backups, abuse controls, and support
model are separately specified. The provider boundary must keep that later option
open, but Phase 1 does not depend on it.

### 5. Account-based invitations

Production sharing will use authenticated accounts, folder membership, and
revocable invitations. Invitations resolve to scoped membership; they do not
embed a long-lived bearer secret that permanently grants workspace access.
Short-lived document tokens remain an implementation detail issued after account
authorization. A share-key-only production model is rejected for the MVP because
revocation, read-only enforcement, auditability, and folder scoping belong at the
service boundary.

## Prototype Evidence

The Phase 0 suite proves:

- overlapping insert/delete/replace operations converge after both reconnect
  orders, including held, reversed, duplicated, and dropped deliveries;
- remote CodeMirror transactions update derived listeners without outbound echo
  or Writer's ordinary save-origin callback;
- shared setup omits native CodeMirror history, while the collaboration keymap
  consumes Yjs undo/redo (including empty-stack commands) and preserves peer edits;
- awareness selections use relative positions, remap after edits, disappear on
  disconnect, swap, and destroy, and republish retained user/cursor state when the
  same mounted client reconnects without replaying queued presence;
- a y-sweet server writes an observed checkpoint, restarts on the same local store,
  serves that state to a fresh client before offline replicas reconnect, then
  converges both offline replicas;
- IndexedDB state survives complete provider/document recreation while offline,
  and a rejected persistence checkpoint is never called queued; and
- the Rust registry elects one projection owner, rejects canonical path collisions
  and non-owner/stale permits, separates attachment lifetime from write fencing,
  and serializes a real temp-file commit against concurrent rebind.

The headless harness does not validate packaged-WebView IME/composition, layout
timing, operating-system storage behavior, production authorization, cross-process
locking, timeout-based awareness expiry, or disk/watcher convergence. Those remain
explicit Phase 1 and Phase 2 gates.

## Consequences

Phase 1 can begin behind a feature flag with a concrete provider and ownership
model. Native CodeMirror history is omitted for shared documents; the Yjs undo
manager and collaboration command path own undo. Non-shared documents stay
on Writer's current editor/save/watcher path.

Relay remains a product and implementation reference, not a dependency. If Relay
later publishes and supports a suitable integration contract, it can be evaluated
as another provider without coupling the editor to its control plane.
