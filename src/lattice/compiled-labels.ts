/** Adapted from Lattice (src/editor/latex/compiled-labels.ts), Apache-2.0, Copyright 2026 Leonardo and the Lattice contributors. Changed: parsing only. */

export type CompiledLabel = { number: string; page: string };

/** The brace-balanced group that opens at `from`, and the offset just past it. */
function group(text: string, from: number): [content: string, end: number] | null {
  if (text[from] !== "{") return null;
  let depth = 0;
  for (let index = from; index < text.length; index += 1) {
    const character = text[index];
    if (character === "\\") index += 1;
    else if (character === "{") depth += 1;
    else if (character === "}" && --depth === 0) return [text.slice(from + 1, index), index + 1];
  }
  return null;
}

/** A number or page as TeX wrote it (`{\relax 3}`, `{\textup {(3)}}`), without its markup. */
const plain = (value: string) => value.replace(/\\[A-Za-z@]+\s*/g, "").replace(/[{}]/g, "").trim();

/**
 * `\newlabel{key}{{number}{page}…}` lines, and the chapter `.aux` files an
 * `\include` adds through `\@input{…}`. cleveref's `key@cref` twins are not
 * labels the writer typed.
 */
export function parseAux(aux: string): { labels: Map<string, CompiledLabel>; inputs: string[] } {
  const labels = new Map<string, CompiledLabel>();
  for (const match of aux.matchAll(/\\newlabel\{([^}]*)\}/g)) {
    const key = match[1];
    const outer = group(aux, match.index + match[0].length);
    const number = outer && group(outer[0], 0);
    const page = outer && number && group(outer[0], number[1]);
    if (key.endsWith("@cref") || !number || !page) continue;
    labels.set(key, { number: plain(number[0]), page: plain(page[0]) });
  }
  return { labels, inputs: [...aux.matchAll(/\\@input\{([^}]+\.aux)\}/g)].map((match) => match[1]) };
}
