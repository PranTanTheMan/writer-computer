import { describe, expect, test } from "vite-plus/test";
import { getPrimaryDefs, suffixOf, type ThemeMode } from "../src/lib/settings-schema";

// Every preset folder ships one JSON per mode holding exactly the editable
// primaries. Glob-load them the same way a preset picker would so adding a
// schema primary (e.g. mono-font) fails here until every preset defines it.
const presetFiles = import.meta.glob<Record<string, unknown>>("../shared/themes/*/*.json", {
  eager: true,
  import: "default",
});

describe("theme presets", () => {
  test("at least one preset file is discovered", () => {
    expect(Object.keys(presetFiles).length).toBeGreaterThan(0);
  });

  test("define every editable primary from the settings schema", () => {
    for (const [path, preset] of Object.entries(presetFiles)) {
      const mode: ThemeMode = path.endsWith("/dark.json") ? "dark" : "light";
      const schemaKeys = getPrimaryDefs(mode)
        .map((def) => suffixOf(mode, def.key))
        .sort();
      expect(Object.keys(preset).sort(), path).toEqual(schemaKeys);
    }
  });
});
