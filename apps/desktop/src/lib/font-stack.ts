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

/** Replace the primary family of a font stack while preserving the current
 *  fallback tail. The previous primary is removed rather than accumulated,
 *  and a duplicate of the picked family is removed from the tail. */
export function stackWithFamily(family: string, currentStack: string): string {
  const name = family.trim();
  const quoted = /^[A-Za-z][A-Za-z0-9-]*$/.test(name) ? name : `"${name.replace(/"/g, '\\"')}"`;
  const tail = currentStack
    .split(",")
    .slice(1)
    .map((part) => part.trim())
    .filter((part) => part.length > 0 && stripQuotes(part) !== name);
  return [quoted, ...tail].join(", ");
}
