/** Where a compound key sits on a line of LaTeX: under the pointer, or being typed. */

const COMPOUND = /\\(r?cmpd\*?|refcmpd|labelcmpd)(?:\[[^\][{}]*\])?\{([^{}]*)\}/g;
const OPEN_COMPOUND = /\\(?:cmpd\*?|refcmpd|labelcmpd)(?:\[[^\][{}]*\])?\{([^}]*)$/;
const OPEN_MARK = /\\rcmpd\{([^}]*)$/;
/** Keys only a drawing's mark gives: a series (`A:cat`) or a sub with a style (`amine.a.num`), cited with `\rcmpd`. */
const MARK_ONLY = /^[AaIi]:|^[^.]+\.[^.]+\.(?:num|dash|letter)$/;

/** The key at `character` in a `\cmpd{a, b}` (one of its keys) or a `\rcmpd{…}` (all of it), with its columns. */
export function compoundKeyAt(line: string, character: number): { key: string; from: number; to: number; mark: boolean } | null {
  for (const match of line.matchAll(COMPOUND)) {
    const contentStart = match.index + match[0].length - 1 - match[2].length;
    if (character < contentStart || character > contentStart + match[2].length) continue;
    const mark = match[1] === "rcmpd";
    let start = contentStart;
    for (const part of mark ? [match[2]] : match[2].split(",")) {
      const end = start + part.length;
      if (character >= start && character <= end && part.trim()) {
        const from = start + part.length - part.trimStart().length;
        return { key: part.trim(), from, to: from + part.trim().length, mark };
      }
      start = end + 1;
    }
  }
  return null;
}

export type CompoundSlot = { from: number; query: string; mark: boolean; afterCmpd: boolean };

/** The key being typed at the end of `before`: inside `\rcmpd{`, or the last of `\cmpd{a,`. */
export function compoundSlot(before: string): CompoundSlot | null {
  const mark = OPEN_MARK.exec(before);
  const compound = mark ? null : OPEN_COMPOUND.exec(before);
  const content = (mark ?? compound)?.[1];
  if (content == null) return null;
  const query = mark ? content : content.slice(content.lastIndexOf(",") + 1).trimStart();
  return { from: before.length - query.length, query, mark: Boolean(mark), afterCmpd: !mark && before.endsWith(`\\cmpd{${query}`) };
}

/** A drawing's mark picked after `\cmpd{`: the command becomes `\rcmpd{`, which it needs. */
export function markInsertion(slot: CompoundSlot, key: string): { from: number; filterText: string; insertText: string } | null {
  if (slot.mark || !slot.afterCmpd || !MARK_ONLY.test(key)) return null;
  return { from: slot.from - 6, filterText: `\\cmpd{${key}`, insertText: `\\rcmpd{${key}` };
}
