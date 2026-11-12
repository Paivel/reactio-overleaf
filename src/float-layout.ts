/**
 * The float around a figure's include line, for the Visual editor: the
 * `\begin{scheme}` (and `\centering`) above it, the `\caption`/`\label` lines
 * and the `\end{scheme}` below. Only a float laid out as a paste makes it is
 * taken; anything else in between and the code stays as it is.
 */
const BEGIN = /^\s*\\begin\{(figure|scheme|chart|graph)(\*?)\}(?:\[[^\]]*\])?\s*(?:%.*)?$/;
const ABOVE = /^\s*(?:\\centering\s*)?(?:%.*)?$/;
const BELOW = /^\s*(?:\\centering|\\caption\{[^{}]*(?:\{[^{}]*\}[^{}]*)*\}|\\label\{[^{}]*\})?\s*(?:%.*)?$/;
const MAX_STEPS = 6;

/** Line indexes (0-based) of the float's `\begin` and `\end`, or null. */
export function floatAround(lines: readonly string[], include: number): { begin: number; end: number } | null {
  let begin = -1;
  for (let index = include - 1; index >= 0 && include - index <= MAX_STEPS; index -= 1) {
    const found = BEGIN.exec(lines[index]);
    if (found) { begin = index; break; }
    if (!ABOVE.test(lines[index])) return null;
  }
  if (begin < 0) return null;
  const [, environment, star] = BEGIN.exec(lines[begin])!;
  const end = new RegExp(`^\\s*\\\\end\\{${environment}${star ? "\\*" : ""}\\}\\s*(?:%.*)?$`);
  for (let index = include + 1; index < lines.length && index - include <= MAX_STEPS; index += 1) {
    if (end.test(lines[index])) return { begin, end: index };
    if (!BELOW.test(lines[index])) return null;
  }
  return null;
}
