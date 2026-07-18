# Typography Font Select Spec

## Goal

Use one ordinary HTML `<select>` for each Typography font setting. Remove the
macOS AppKit Font panel, its trigger, and the editable CSS-stack field.

## Behavior

- Each row lists installed font families in a standard select styled exactly
  like the existing enum setting control.
- UI and editor default to SF Pro; the **Code font** row defaults to SF Mono. Its
  persisted key remains `fonts.mono`. The existing
  cross-platform fallback stacks remain behind those primary families.
- The selected option is the primary family from the stored CSS font stack.
- Choosing a family replaces only that primary family and preserves the stored
  fallback tail.
- If the current primary family is not returned by system enumeration, include
  it as the selected option so existing settings remain representable.
- While families load, keep the select visible and disabled. If enumeration
  fails, keep the current family visible and show a concise inline error.
- Keep the section name **Typography** and the existing `fonts.*` keys, reset
  behavior, CSS bindings, and ordered persistence.

## Implementation

- Restore the cached `list_system_fonts` command backed by `fontdb` on all
  desktop platforms.
- Restore a shared cached React hook for that command.
- Remove AppKit font-panel commands/events/controller tests and render the
  select directly from `FontControl`.
- Update E2E coverage to assert a real native select, installed options,
  primary replacement, fallback preservation, CSS application, and backend
  persistence.

## Validation

- `vp check`
- `vp test`
- `cargo test`
- `cargo clippy`
- `cargo fmt --check`
- Packaged WebDriver font-picker and smoke specs
