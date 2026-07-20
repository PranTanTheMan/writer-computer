import katex from "katex";

const HTML_CACHE_LIMIT = 200;
const htmlCache = new Map<string, string>();

export interface MathRenderResult {
  html: string;
  error?: undefined;
}

export interface MathRenderError {
  html?: undefined;
  error: string;
}

function cacheGet(key: string): string | undefined {
  const cached = htmlCache.get(key);
  if (cached === undefined) return undefined;
  // Refresh recency: re-insert at the end so least-recently-used stays at the
  // front for eviction.
  htmlCache.delete(key);
  htmlCache.set(key, cached);
  return cached;
}

function cacheSet(key: string, value: string): void {
  if (htmlCache.has(key)) htmlCache.delete(key);
  htmlCache.set(key, value);
  while (htmlCache.size > HTML_CACHE_LIMIT) {
    const oldest = htmlCache.keys().next().value;
    if (oldest === undefined) break;
    htmlCache.delete(oldest);
  }
}

// Synchronous on purpose: KaTeX renders to a markup string with no DOM or
// async work, and the cache makes repeat renders O(map lookup), so widgets can
// paint in `toDOM` with no placeholder gap (see docs/editor.md).
//
// `trust: false` (the KaTeX default) refuses `\href`, `\htmlClass`, and other
// commands that could smuggle attacker-controlled HTML/URLs out of documents
// that come from external sources (Obsidian vaults, repos). `throwOnError:
// false` renders soft errors as the raw source in KaTeX's error color; hard
// parse failures still throw and are surfaced as `{ error }`.
export function renderMath(
  formula: string,
  displayMode: boolean,
): MathRenderResult | MathRenderError {
  const key = (displayMode ? "D:" : "I:") + formula;
  const cached = cacheGet(key);
  if (cached !== undefined) return { html: cached };

  try {
    const html = katex.renderToString(formula, {
      displayMode,
      throwOnError: false,
      output: "html",
    });
    cacheSet(key, html);
    return { html };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { error: message };
  }
}

export function clearMathCache() {
  htmlCache.clear();
}
