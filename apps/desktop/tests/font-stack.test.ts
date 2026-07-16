import { describe, expect, test } from "vite-plus/test";
import { firstFamily, stackWithFamily } from "../src/lib/font-stack";

const MONO_DEFAULT =
  'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace';

describe("firstFamily", () => {
  test("returns the first family of a stack", () => {
    expect(firstFamily(MONO_DEFAULT)).toBe("ui-monospace");
  });

  test("strips quotes from the first family", () => {
    expect(firstFamily('"JetBrains Mono", monospace')).toBe("JetBrains Mono");
    expect(firstFamily("'SF Mono', Menlo")).toBe("SF Mono");
  });

  test("handles a single unquoted family and empty input", () => {
    expect(firstFamily("Menlo")).toBe("Menlo");
    expect(firstFamily("")).toBe("");
  });
});

describe("stackWithFamily", () => {
  test("prepends the picked family to the default stack", () => {
    expect(stackWithFamily("Menlo", "ui-monospace, monospace")).toBe(
      "Menlo, ui-monospace, monospace",
    );
  });

  test("quotes families that are not plain CSS idents", () => {
    expect(stackWithFamily("JetBrains Mono", "monospace")).toBe('"JetBrains Mono", monospace');
    expect(stackWithFamily("Comic Sans MS", "sans-serif")).toBe('"Comic Sans MS", sans-serif');
  });

  test("drops a duplicate of the picked family from the default tail", () => {
    expect(stackWithFamily("Menlo", MONO_DEFAULT)).toBe(
      'Menlo, ui-monospace, SFMono-Regular, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
    );
    expect(stackWithFamily("Courier New", 'Menlo, "Courier New", monospace')).toBe(
      '"Courier New", Menlo, monospace',
    );
  });

  test("repeated picks do not grow the stack", () => {
    const once = stackWithFamily("Fira Code", MONO_DEFAULT);
    const twice = stackWithFamily("JetBrains Mono", MONO_DEFAULT);
    expect(twice.split(",").length).toBe(once.split(",").length);
  });
});
