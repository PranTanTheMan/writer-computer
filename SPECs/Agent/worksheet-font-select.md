# Worksheet: Typography Font Selects

## Task

- TODO: `Select-only Typography font controls`
- Spec: [`../font-select-spec.md`](../font-select-spec.md)

## Intent

Replace the AppKit Font panel and editable CSS-stack field with the same
ordinary HTML select used by enum settings. Set new/reset defaults to SF Pro
for UI and editor text and SF Mono for the renamed Code font setting, retaining the previous
cross-platform fallback tails.

## Implementation

- Restored cached, background `fontdb` enumeration through
  `list_system_fonts` on every desktop platform.
- Added one shared `SelectControl` used by enum and font settings.
- `FontControl` keeps a missing current family representable, disables the
  select while loading, reports enumeration/save failures, and replaces only
  the stored stack's primary family.
- Removed the AppKit panel IPC, event routing, controller hook, and associated
  routing/controller tests.
- Updated schema defaults, docs, changelog, and packaged E2E coverage.

## Review

- React/state: **GREEN** with a P2 recommendation to guard stale save errors;
  added a per-attempt generation guard and exact fallback-default assertions.
- Rust: **GREEN** with P2 recommendations for empty enumeration and
  host-dependent testing; empty results now fail explicitly and normalization
  uses a pure fixture-backed test.
- QA/UX: **GREEN**; successful-path E2E covers real selects, installed options,
  a missing current family, exact fallback preservation, CSS, and persistence.

## Validation

- `vp check`: passed with the existing `wdio.conf.js` JSDoc warning.
- `vp test`: 33 files / 500 tests passed.
- `cargo test`: 123 tests passed.
- `cargo clippy`: passed with pre-existing warnings in search/config/images.
- `cargo fmt --check`: passed.
- `vp run desktop#build`: passed.
- Packaged custom-protocol E2E: font-select spec 3/3 and smoke spec 2/2
  passed. The final font-select rerun completed without WebDriver errors.
