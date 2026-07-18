# Global Font Settings Spec

## Goal

Fonts are picked once, not per color mode. The three font stacks (UI, editor
body, monospace) move out of the per-mode theme primaries
(`theme.{light,dark}.{ui,editor,mono}-font`) into global settings
(`fonts.ui`, `fonts.editor`, `fonts.mono`) in a new "Typography" settings section
rendered between Appearance and the theme cards.

Rationale: a font choice is typographic, not chromatic — users who set a
font expect it in both light and dark mode, and the duplicated per-mode
entries meant six controls for three decisions (and let the modes silently
drift apart).

## Design

- **Schema** (`shared/settings.schema.json`): the six `theme.*.{...}-font`
  entries are replaced by three `fonts.*` entries, category `Typography`, type
  `font`, binding the same CSS variables (`--ui-font`, `--editor-font`,
  `--mono-font`). Because the keys no longer start with `theme.`, the
  generic `applyCssVarBindings` side effect (lib/theme.ts) pushes them to
  `:root` — no mode-aware code involved.
- **Theme primaries**: `PrimarySuffix` shrinks to
  `accent | background | foreground | translucent | contrast`. Preset JSONs
  (`shared/themes/*/{light,dark}.json`) drop their font keys; the
  settings-schema test enforces exact preset/primary parity.
- **Settings panel**: the "Typography" category renders through the generic
  section renderer, ordered via `SECTIONS_BEFORE_THEMES` so it sits above
  the theme cards.
- **Migration** (`config.rs::migrate_theme_fonts`, runs at startup): for
  each slot, if the global config still has an old per-mode key and the new
  key is unset, adopt the light value (dark as fallback), then remove the
  old keys from the config file. Old keys are kept on a failed write so a
  later launch retries. Workspace configs are left untouched — stale keys
  there are inert because the schema no longer knows them.

## Unified font control

`FontControl` is an ordinary HTML select styled like the other enum settings.
It lists installed families from the cached `list_system_fonts` command on all
desktop platforms. Choosing a family replaces the stored stack's primary
family while preserving its fallback tail. If the current primary is not in
the enumeration, it remains available as the selected option. See
[`font-select-spec.md`](font-select-spec.md).

## Test Plan

- `config.rs::test_theme_font_migration` — adoption (light wins, dark
  fallback), untouched slots keep defaults, old keys removed from the file,
  idempotency (an existing `fonts.*` value is not overwritten).
- `tests/settings-schema.test.ts` — preset/primary parity now excludes
  fonts.
- `e2e/specs/font-picker.spec.js` — retargeted at the "Typography" section and
  the `fonts.mono` key.
