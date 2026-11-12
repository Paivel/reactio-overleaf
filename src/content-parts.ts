/** What a paste puts in the open file, apart from the page: kept pure for tests. */
import { editableFigureChanges, editableFigureInclude, pastesFigureBlock, type ChangeSpec, type ImportedFigure } from "./lattice/editable-figure";
import { floatKind } from "./float-kind";

/** The float for a pasted figure, and where the caret goes in it (the caption). */
export function figureBlock(figure: Pick<ImportedFigure, "directory" | "entry">, environment: string, labelPrefix: string): { text: string; caret: number } {
  const head = `\\begin{${environment}}\n\t\\centering\n\t${editableFigureInclude(figure)}\n\t\\caption{`;
  // The label is named after the figure, so `\\ref{sch:scheme}` works at once.
  const name = figure.entry.replace(/\.tex$/i, "").replace(/[^A-Za-z0-9_-]+/g, "-");
  return { text: `${head}}\n\t\\label{${labelPrefix}${name}}\n\\end{${environment}}`, caret: head.length };
}

/** The changes a paste makes in the open file, and where the caret goes after them (in the text before any change). */
export function pasteChanges(text: string, selection: { from: number; to: number }, figure: ImportedFigure, addPreamble: boolean): { changes: ChangeSpec[]; caretInInsert: number; unplaced: string[] } {
  const placed = addPreamble ? figure : { ...figure, preamble: undefined };
  const { changes, unplaced } = editableFigureChanges(text, selection, placed);
  let caretInInsert = changes[0].insert.length;
  if (pastesFigureBlock(text, selection)) {
    const kind = floatKind(text, "auto");
    const block = figureBlock(figure, kind.environment, kind.labelPrefix);
    changes[0] = { ...changes[0], insert: block.text };
    caretInInsert = block.caret;
  }
  return { changes, caretInInsert, unplaced };
}
