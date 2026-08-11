# Worksheet: Configurable Default Terminal

## References

- TODO: Configurable default terminal
- Spec: [`../configurable-default-terminal-spec.md`](../configurable-default-terminal-spec.md)

## Reviewed

- `TODOS.md`; `docs/workflows/agent-loop.md`; `docs/workflows/agent-review.md`
- `docs/consolidation.md`; `docs/react-guidelines.md`
- Shared settings schema, generic settings controls/store, Rust settings layer, and workspace terminal launcher

## Baseline

- `vp install`: passed.
- `vp check`: passed with one pre-existing non-failing `wdio.conf.js` JSDoc warning.
- `vp test`: 37 files / 536 tests passed.
- Rust: 131 tests passed; clippy completed with existing warnings; formatting passed.

## Plan

1. Add one global string setting to the shared schema, including exact cross-platform help and placeholder copy plus trim normalization, so Preferences stays generic.
2. Make schema-declared string keys bypass boolean/number inference while parsing their raw tokens, preserving executable spelling such as `TRUE`, `00123`, and `1e3` exactly across disk reloads; cover custom/reset reconstruction.
3. Add a global/default-only cloned string accessor at the Rust settings boundary. Preserve the documented existing multi-window behavior: each open window has its own hydrated settings snapshot.
4. Make launch-spec construction accept the preference: explicit values produce exactly one attempt and override all defaults; empty/whitespace values preserve current per-platform behavior.
5. Give launch specs an execution policy: wait for and validate the short-lived macOS `open` helper, while Windows/Linux terminal processes remain detached. Keep all construction shell-free and return recovery-oriented errors for custom choices.
6. Add focused schema, persistence, reset, exact platform-matrix, and outcome coverage; validate, run independent implementation review, update task/changelog, and commit this task alone.

## Risks / Edge Cases

- macOS uses application names while Windows/Linux use executable names or paths; the setting description must be explicit.
- An explicit invalid terminal must fail visibly so the user's choice is not silently ignored; macOS must inspect `open`'s exit status rather than treating helper spawn as success.
- The settings lock should only be held while cloning the string, never while validating the workspace or spawning a process.
- Global settings are independently hydrated per window today; the invoking window's global/default value is authoritative until that window reloads, and workspace overrides are intentionally ignored for this app-level choice.
- Schema-declared strings that resemble booleans or numbers must retain their exact lexical spelling after reload; do not infer and then coerce because that loses case and leading-zero/exponent forms.
- Table-driven launch-spec tests should assert the full count/order, program, arguments, working directory, console/execution policy, preference precedence, and opaque treatment of metacharacters.

## Plan Review

- UX and Rust reviewers caught that macOS `open -a` can spawn successfully and then exit non-zero; the revised plan adds an explicit wait/check policy and recovery-oriented error copy.
- QA found that the schema-unaware config parser reloads string values such as `true` and `123` with the wrong type; schema-aware hydration and disk round-trip/reset tests are now part of this task.
- Plan re-review tightened that fix further: declared string keys must bypass type inference at parse time so lexically sensitive values such as `TRUE`, `00123`, and `1e3` are not rewritten.
- The spec now defines exact UI guidance, trim semantics, global/default-only lookup, and the existing per-window hydration behavior rather than implying unsupported live propagation.

## Implementation Result

- Added the schema-owned Workspace preference with exact cross-platform guidance, a Platform default placeholder, and trim normalization rendered by the generic settings control.
- Made settings parsing honor declared string types before generic inference, preserving executable spelling across write/reload/reset, and added global/default-only lookup for this app-level preference.
- Extended terminal launch specs with an explicit preference and execution policy. Custom choices produce exactly one shell-free attempt; macOS waits for `open` and checks its result, while Windows/Linux remain detached.
- Updated launch failures to identify invalid custom choices, point to the reset path, and use neutral frontend wording.
- Extended the local macOS E2E Preferences assertion to cover the new row and placeholder.
- Kept text drafts independent from asynchronous canonical responses, and made settings reconciliation bail out for unchanged scalar and list values.

## Validation

- Focused TypeScript schema tests: passed.
- Focused Rust config and terminal-launch tests: passed, including a real invalid macOS `open -a` outcome.
- `vp run desktop#dev`: compiled, launched, and remained stable until intentionally stopped.
- `vp check`: passed with the one pre-existing non-failing `wdio.conf.js` JSDoc warning.
- `vp test`: 37 files / 540 tests passed.
- Rust: 136 tests passed; `cargo clippy` and `cargo fmt --check` passed with only pre-existing warnings.
- Independent spec and standards reviews passed. Review feedback closed global-scope enforcement, canonical-response reconciliation, active text-draft safety, redundant settings publishes, and duplicate launcher normalization.
