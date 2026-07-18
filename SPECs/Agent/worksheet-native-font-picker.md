# Worksheet: Native Font Picker

## Task

- TODO: `Native macOS font picker + Typography settings`
- Spec: [`../native-font-picker-spec.md`](../native-font-picker-spec.md)

## Workspace and Baseline

- Worktree was clean at task start.
- Baseline `vp check`: passed with two pre-existing E2E lint warnings.
- Baseline `vp test`: 32 files / 493 tests passed.
- Baseline `cargo test`: 123 tests passed with pre-existing dead-code warnings.
- Baseline `cargo clippy` and `cargo fmt --check`: passed; clippy reported only
  pre-existing warnings in `images.rs`, `config.rs`, and dead code.

## Reviewed

- `TODOS.md`, `docs/workflows/agent-loop.md`,
  `docs/workflows/agent-review.md`, `docs/react-guidelines.md`, and
  `docs/consolidation.md`.
- `SPECs/global-font-settings-spec.md`, current font control/hook, font-stack
  helper/tests, schema, Tauri command registration, existing `dock_menu.rs`
  Objective-C bridge, and font-picker E2E.
- Current `objc2-app-kit` 0.3.2 bindings plus Apple `NSFontManager` /
  `NSFontPanel` documentation. AppKit has one shared panel; `NSFontManager`
  sends its configured action to a weak target, and receivers apply the current
  panel conversion with `convertFont:`.

## Plan

1. Change the schema category and ordered settings section to Typography; keep
   all `fonts.*` keys and defaults unchanged.
2. Replace font enumeration with a compile-gated, main-thread macOS
   `NSFontPanel` bridge using the repo's existing raw-`objc2` approach:
   register stable action/validation methods with exact Objective-C ABIs, store
   the active window label plus an opaque per-open token in testable
   thread-safe routing state, convert the currently selected font inside a
   null-safe/non-panicking callback, and emit the resulting family after
   releasing the route lock.
3. Make panel opening a single acknowledged transaction: one main-thread
   closure validates setup, initializes the panel, installs target/action and
   route, then opens it; an async IPC command awaits the closure's explicit
   result over a oneshot. A token-matched deactivate command clears stale
   origins on control/window teardown without clearing a newer request.
4. Simplify `FontControl` to the editable stack input plus a macOS-only native
   picker trigger. A co-located hook uses a pure/testable controller to register
   before open, filter by the current opaque token, read live stack/callback
   refs, and safely clean up even when listener setup resolves after unmount.
   Preserve the user's current fallback tail, give each input/button a
   row-specific accessible name, and expose a small visible failure message
   while leaving free-text editing available.
5. Serialize optimistic settings persistence per key in the settings store and
   guard rollback by mutation generation. This keeps every native selection's
   UI/CSS update immediate while preventing backend completion reordering or a
   stale failure from clobbering a newer value. Cover it with deferred-promise
   tests.
6. Remove the custom popover/hook, font enumeration command/test, and `fontdb`.
   Centralize platform detection before reusing it outside sidebar menus.
7. Retarget E2E/docs/changelog, add Rust routing, TypeScript controller,
   settings-ordering, schema, platform, and fallback-stack tests; validate the
   automated suites and complete the mandatory macOS manual matrix.

## Risks and Edge Cases

- AppKit calls must stay on the main thread and the font manager target is weak;
  use the lifetime-stable Tauri app delegate rather than a temporary object.
- The native panel is shared across windows, so every open replaces the active
  `{ window, token }` routing record inside the same main-thread transaction
  that initializes and opens the panel.
- CSS generic names are not necessarily AppKit font names; initialize with the
  system font when lookup fails without changing the stored value.
- Settings store a family stack only. Request a family-only native panel mode,
  emit `familyName`, and deliberately ignore size/face if the OS still exposes
  those controls.
- Native panel interaction is outside WebDriver's DOM; automated coverage can
  prove the trigger and web-side routing shape, while the actual panel needs a
  macOS smoke check.

## Plan Review

- Rust/Tauri + Systems reviews required transactional main-thread setup with an
  acknowledged result, explicit macOS cfg boundaries, non-panicking callback
  invariants, opaque request tokens, and pure multi-window routing tests. Plan
  updated accordingly; raw `objc2` remains preferable because it matches the
  existing AppKit bridge and does not rely on transitive typed bindings.
- UX review required preserving the current edited tail, origin teardown,
  row-specific accessibility labels, family-only semantics, visible launch
  failure, and a stronger manual matrix. Plan updated accordingly.
- React/QA reviews required an explicit ref-based listener lifecycle and
  automated coverage for web-side token filtering/teardown. The plan now uses a
  co-located hook backed by a dependency-injected controller and awaits listener
  readiness before opening the panel.
- A broader same-key settings write race was identified. Ordering belongs in
  the settings store, so the plan now serializes per-key persistence and guards
  rollback by mutation generation instead of trying to approximate correctness
  inside `FontControl`.

## Implementation and Results

- Replaced `fontdb` enumeration and the React portal/listbox with a macOS-only
  AppKit bridge over the existing Tauri application delegate. The bridge opens
  the shared Font panel, initializes its selection, routes family changes by
  window plus opaque request token, and closes only a matching active route.
- Added the web-side controller/hook, row-specific accessible labels, visible
  failure state, current-tail preservation, and per-key ordered settings
  persistence with guarded rollback. Non-macOS keeps the full editable stack
  and does not render a picker imitation.
- Renamed the schema category and rendered heading to **Typography** without
  changing persisted `fonts.*` keys or CSS bindings. Updated descriptions,
  specs, changelog, and E2E expectations.
- Added five Rust routing tests, six native-controller/token tests, four deferred
  persistence-ordering tests, and expanded stack/schema coverage. Reset now
  shares the same per-key lane, so it cannot be overtaken by queued selections.

## Implementation Review

- Rust/Tauri + systems: **GREEN** after adding same-window/different-token
  cleanup coverage and documenting the existing webview-local persistence
  boundary.
- React/state: fixed the P1 reset race by routing reset through the per-key
  mutation lane and updating only its authoritative key; follow-up **GREEN**.
- QA/UX: replaced `crypto.randomUUID` with a Catalina-compatible
  `getRandomValues` token, caught direct-edit failures, and made the E2E
  persistence assertion poll the backend; follow-up code verdict **GREEN**.

## Validation Results

- `vp check`: passed (one pre-existing `wdio.conf.js` JSDoc lint warning).
- `vp test`: 34 files / 505 tests passed.
- `cargo test`: 127 tests passed.
- `cargo clippy`: passed with pre-existing warnings in search/config/images.
- `cargo fmt --check`: passed.
- `vp run desktop#build`: passed.
- Direct release E2E bundle build with `e2e` and Tauri's `custom-protocol`
  feature: passed.
- `pnpm run test:wdio`: 2 spec files / 6 tests passed, including the real
  `open_native_font_panel` IPC path, scoped event routing, persistence, CSS
  application, direct stack editing, and the smoke IPC write.
- The normal `pnpm test:e2e` wrapper stops at its existing Tauri dependency
  skew preflight (`tauri` 2.11.2 vs JS API 2.10.1; dialog 2.7.1 vs 2.6.0), so
  validation used the already-built E2E app and direct WebDriver runner.
- The panel was opened from the packaged app. Screenshot and accessibility
  automation of AppKit's separate window were unavailable because this agent
  process lacks macOS Screen Recording and Accessibility permissions; visual
  family-only layout, native selection, VoiceOver, and the full multi-window
  manual matrix remain a release smoke-check.
