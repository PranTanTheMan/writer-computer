/** Helpers for CSS `font-family` stacks stored in font settings. */

function stripQuotes(name: string): string {
  const match = name.match(/^(["'])(.*)\1$/);
  return match ? match[2] : name;
}

/** First family of a stack, unquoted — what the picker displays and marks
 *  as selected. */
export function firstFamily(stack: string): string {
  return stripQuotes((stack.split(",")[0] ?? "").trim());
}

/** Swap the primary family of a font setting: the picked family (quoted
 *  unless it is a plain CSS ident) followed by the schema-default stack as
 *  the fallback tail, minus any duplicate of the picked family. Building the
 *  tail from the default rather than the current value keeps repeated picks
 *  from growing the stack. */
export function stackWithFamily(family: string, defaultStack: string): string {
  const name = family.trim();
  const quoted = /^[A-Za-z][A-Za-z0-9-]*$/.test(name) ? name : `"${name.replace(/"/g, '\\"')}"`;
  const tail = defaultStack
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part.length > 0 && stripQuotes(part) !== name);
  return [quoted, ...tail].join(", ");
}
