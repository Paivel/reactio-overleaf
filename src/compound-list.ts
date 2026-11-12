/**
 * The project's compounds as a list to look a number up in: the number the
 * last build gave each, its key, the exact LaTeX that cites it, and where it
 * is drawn. A reader who sees "2.1" in the PDF finds `\rcmpd{amine.a.num}`.
 */
import { compoundCommand, compoundEntries, compoundKeysIn } from "./lattice/compound-keys";

export type CompoundRow = { key: string; number?: string; command: string; place?: string };

const STYLED = /^[^.]+\.[^.]+\.(?:num|dash|letter)$/;

/** Keys the sources cite with `\rcmpd`: drawn marks, which must be cited the same way. */
function markKeys(sources: readonly string[]): Set<string> {
  const keys = new Set<string>();
  for (const text of sources) for (const found of text.matchAll(/\\rcmpd\s*\{([^{}\\%\r\n]{1,200})\}/g)) keys.add(found[1].trim());
  return keys;
}

export function compoundRows(sources: readonly string[], numbers: Map<string, string>, places: Map<string, string>): CompoundRow[] {
  const marks = markKeys(sources);
  return compoundEntries(compoundKeysIn([...sources]), numbers).map(({ key, number }) => ({
    key,
    number,
    command: compoundCommand(key, marks.has(key) || STYLED.test(key)),
    place: places.get(key),
  }));
}

/** The rows a number typed in the search box names first: exactly that number, then numbers that start with it. */
export function rowsForNumber(rows: readonly CompoundRow[], typed: string): CompoundRow[] {
  const wanted = typed.trim();
  if (!wanted) return [...rows];
  const exact = rows.filter((row) => row.number === wanted);
  const starting = rows.filter((row) => row.number !== wanted && row.number?.startsWith(wanted));
  return [...exact, ...starting];
}
