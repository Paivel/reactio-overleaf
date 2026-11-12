/**
 * Reactio Draw figures in Overleaf: a figure copied in Reactio Draw with
 * Copy for LaTeX pastes into the Overleaf editor with its files. The include
 * line (or a whole float) goes in at once, the files are uploaded to the
 * project's `figures/` folder, and the root document's preamble gets the
 * packages and `\graphicspath` it lacks.
 */
import { editableFigureFromHtml, editableFigureInclude, preambleNeedsConfirmation } from "./lattice/editable-figure";
import { pasteChanges } from "./content-parts";
import { FigureError, planFigure } from "./plan";
import { editorView, fileTree, projectId, uploadFile, type EditorViewLike } from "./overleaf";
import { toast } from "./toast";
import { startEditing } from "./edit";
import { installEditorParts, installPanelButton } from "./compounds";
import { startPdf } from "./pdf";

const FIGURES_FOLDER = "figures";
const MARK = "__reactioOverleaf";

async function pasteFigure(view: EditorViewLike, html: string) {
  const manifest = editableFigureFromHtml(html);
  if (!manifest) return;
  const project = projectId();
  const tree = fileTree();
  if (!project || !tree) {
    toast("Reactio: could not read this Overleaf project's files. Reload the page and paste again.", "error");
    return;
  }
  let plan;
  try {
    plan = planFigure(tree, manifest, FIGURES_FOLDER);
  } catch (error) {
    toast(`Reactio: ${error instanceof FigureError ? error.message : (error as Error).message}`, "error");
    return;
  }
  // The files go up first: Overleaf compiles as soon as the text changes, and
  // an \input of a file not there yet stops the build.
  const done = toast(`Reactio: uploading ${plan.files.length} files to ${FIGURES_FOLDER}/…`, "progress");
  try {
    for (const file of plan.files) await uploadFile(project, tree._id, file.path, file.bytes);
  } catch (error) {
    done();
    toast(`Reactio: ${(error as Error).message} Nothing was added to the text.`, "error");
    return;
  }
  done();
  // Read now, not at the paste: the text and the caret may have moved meanwhile.
  if (!view.contentDOM.isConnected) {
    const include = editableFigureInclude(plan.figure);
    toast(`Reactio: figure uploaded, but its file was closed meanwhile. Paste this line where it goes:\n${include}`, "info", include);
    return;
  }
  const text = view.state.doc.toString();
  const selection = { from: view.state.selection.main.from, to: view.state.selection.main.to };
  let addPreamble = true;
  if (preambleNeedsConfirmation(text, "", plan.figure)) {
    addPreamble = window.confirm(`This figure wants to add these lines to the preamble. Add them?\n\n${(plan.figure.preamble ?? []).join("\n")}`);
  }
  const { changes, caretInInsert, unplaced } = pasteChanges(view.state.doc.toString(), { from: view.state.selection.main.from, to: view.state.selection.main.to }, plan.figure, addPreamble);
  const mapping = view.state.changes(changes);
  const caret = mapping.mapPos(view.state.selection.main.from, -1) + caretInInsert;
  view.dispatch({ changes, selection: { anchor: caret }, scrollIntoView: true, userEvent: "input.paste" });
  view.focus();
  if (unplaced.length) {
    toast(`Reactio: figure uploaded. This file is not the main document; add to the main document's preamble:\n${unplaced.join("\n")}`, "info", unplaced.join("\n"));
  } else {
    toast(`Reactio: figure uploaded to ${plan.figure.directory}/${plan.figure.entry}.`, "success");
  }
}

/** Pastes into the editor carrying a figure manifest are taken over; any other paste goes on as usual. */
function onPaste(event: ClipboardEvent) {
  const target = event.target as Element | null;
  if (!target?.closest?.(".cm-editor")) return;
  const html = event.clipboardData?.getData("text/html") ?? "";
  if (!html.includes("data-editable-figure")) {
    console.info("[Reactio for Overleaf] paste without a Reactio figure; clipboard types:", [...(event.clipboardData?.types ?? [])], "html length:", html.length);
    return;
  }
  const view = editorView();
  if (!view || !view.contentDOM.contains(target)) return;
  event.preventDefault();
  event.stopImmediatePropagation();
  void pasteFigure(view, html).catch((error) => toast(`Reactio: ${(error as Error).message}`, "error"));
}

const page = window as unknown as Record<string, boolean>;
if (!page[MARK]) {
  page[MARK] = true;
  // Capture on the window: before Overleaf's and CodeMirror's own paste handlers read the text.
  window.addEventListener("paste", onPaste, true);
  startEditing();
  installEditorParts();
  installPanelButton();
  startPdf();
  console.info("[Reactio for Overleaf] loaded");
}
