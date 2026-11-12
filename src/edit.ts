/**
 * Editing a pasted figure's drawing from Overleaf: a double click on the line
 * that includes the figure sends its drawing to the helper on this computer,
 * which opens it in Reactio Draw. Each save there writes the drawing's .pdf
 * and .tex again; the helper sends them back and they are uploaded over the
 * project's copies.
 */
import { figureSourcePath, includedTexPaths } from "./lattice/editable-figure";
import { CHANNEL, type Envelope, type PageNotice, type PageRequest } from "./messages";
import { downloadDoc, downloadFile, editorView, fileTree, openDocId, projectId, uploadFile } from "./overleaf";
import { DRAWING_EXTENSIONS, entityAt, extensionOf, folderAt, pathOf, type TreeFolder } from "./plan";
import { toast } from "./toast";

/** Figure folders whose drawings were opened from this page: only their files come back. */
const OPENED_KEY = "reactio-overleaf-opened";
const opened = new Set<string>(readOpened());

/** Kept for this tab, so files saved while the page reloaded still come in. */
function readOpened(): string[] {
  try {
    return JSON.parse(sessionStorage.getItem(OPENED_KEY) ?? "[]");
  } catch {
    return [];
  }
}

function remember(folder: string) {
  opened.add(folder);
  try {
    sessionStorage.setItem(OPENED_KEY, JSON.stringify([...opened]));
  } catch {
    // Without storage, only this page load's figures come back.
  }
}
const answers = new Map<string, (notice: PageNotice) => void>();

const toExtension = (body: PageRequest) => window.postMessage({ channel: CHANNEL, to: "extension", body } satisfies Envelope, location.origin);

function base64(bytes: Uint8Array): string {
  let binary = "";
  for (let index = 0; index < bytes.length; index += 0x8000) binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  return btoa(binary);
}

function fromBase64(text: string): Uint8Array {
  const binary = atob(text);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

/** The figure a source line includes and its drawing, as project paths; null when the line includes none. */
export async function figureOnLine(project: string, tree: TreeFolder, line: string, fromPath: string): Promise<{ entry: string; source: string } | null> {
  if (!/\\(?:input|include|import|subimport)\b/.test(line)) return null;
  for (const entry of includedTexPaths(line, fromPath)) {
    const doc = entityAt(tree, entry);
    if (doc?.type !== "doc") continue;
    const text = await downloadDoc(project, doc.id);
    const source = figureSourcePath(entry, text.split(/\r?\n/, 1)[0]);
    if (source) return { entry, source };
  }
  return null;
}

const dirOf = (path: string) => path.slice(0, Math.max(0, path.lastIndexOf("/")));
const nameOf = (path: string) => path.slice(path.lastIndexOf("/") + 1);

async function editFigureAt(event: MouseEvent) {
  const view = editorView();
  const project = projectId();
  const tree = fileTree();
  if (!view || !project || !tree) return;
  const pos = view.posAtCoords({ x: event.clientX, y: event.clientY });
  if (pos === null) return;
  const line = view.state.doc.lineAt(pos).text;
  const openId = openDocId();
  const fromPath = (openId && pathOf(tree, openId)) || "main.tex";
  const figure = await figureOnLine(project, tree, line.replace(/(?<!\\)%.*$/, ""), fromPath);
  if (figure) await openDrawing(project, tree, figure.source);
}

/**
 * The figure a place in the source belongs to, as SyncTeX names it after a
 * double click in the PDF: a line of a figure's entry file, or a line that
 * includes a figure.
 */
export async function figureAtSource(project: string, tree: TreeFolder, file: string, line: number): Promise<{ entry: string; source: string } | null> {
  const path = file.replace(/^\.?\/+/, "");
  const doc = entityAt(tree, path);
  if (doc?.type !== "doc") return null;
  const text = await downloadDoc(project, doc.id);
  const source = figureSourcePath(path, text.split(/\r?\n/, 1)[0]);
  if (source) return { entry: path, source };
  const lines = text.split(/\r?\n/);
  const tryLine = (at: number) => (at >= 0 && at < lines.length ? figureOnLine(project, tree, lines[at].replace(/(?<!\\)%.*$/, ""), path) : Promise.resolve(null));
  // SyncTeX may name the include, the line after it, or (for a point on a picture) the caption or the end of the float.
  for (const at of [line - 1, line - 2, line]) {
    const found = await tryLine(at);
    if (found) return found;
  }
  // Up through the float the line is in, as far as its \begin.
  for (let at = line - 3; at >= Math.max(0, line - 12); at -= 1) {
    if (/\\end\{/.test(lines[at] ?? "")) break;
    const found = await tryLine(at);
    if (found) return found;
    if (/\\begin\{(?:figure|scheme|chart|graph|table)/.test(lines[at] ?? "")) break;
  }
  return null;
}

/** Sends a figure's drawing to the helper, which opens it in Reactio Draw. */
export async function openDrawing(project: string, tree: TreeFolder, sourcePath: string) {
  const name = nameOf(sourcePath);
  if (!DRAWING_EXTENSIONS.includes(extensionOf(name))) {
    toast(`Reactio: ${name} is not a drawing that opens in Reactio Draw.`, "error");
    return;
  }
  const file = entityAt(tree, sourcePath);
  if (file?.type !== "file") {
    toast(`Reactio: the drawing ${sourcePath} is not in the project.`, "error");
    return;
  }
  const done = toast(`Reactio: opening ${name} in Reactio Draw…`, "progress");
  try {
    const data = base64(await downloadFile(project, file.id));
    // The figure's .tex and .pdf go along: Reactio Draw writes them again on each save only when they are beside the drawing.
    const stem = name.replace(/\.[^.]*$/, "");
    const folder = folderAt(tree, dirOf(sourcePath));
    const outputs: { name: string; data: string }[] = [];
    const tex = folder?.docs.find((doc) => doc.name === `${stem}.tex`);
    const pdf = folder?.fileRefs.find((ref) => ref.name === `${stem}.pdf`);
    // Without them the drawing still opens; only a save then writes no figure for Overleaf.
    if (tex) await downloadDoc(project, tex._id).then((text) => outputs.push({ name: tex.name, data: base64(new TextEncoder().encode(text)) }), () => undefined);
    if (pdf) await downloadFile(project, pdf._id).then((bytes) => outputs.push({ name: pdf.name, data: base64(bytes) }), () => undefined);
    const requestId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const answer = await new Promise<PageNotice>((resolve) => {
      answers.set(requestId, resolve);
      toExtension({ kind: "open", requestId, project, dir: dirOf(sourcePath), name, data, outputs });
      setTimeout(() => resolve({ kind: "error", requestId, message: "The extension did not answer. Reload the extension and this page." }), 20_000);
    });
    answers.delete(requestId);
    done();
    if (answer.kind === "error") {
      toast(`Reactio: ${answer.message}`, "error");
      return;
    }
    remember(`${project}/${dirOf(sourcePath)}`);
    toast(`Reactio: ${name} is open in Reactio Draw. Each save there updates the figure here; recompile to see it.`, "success");
  } catch (error) {
    done();
    toast(`Reactio: ${(error as Error).message}`, "error");
  }
}

const UPLOADABLE = new Set([...DRAWING_EXTENSIONS, "tex", "pdf", "pdf_tex", "png", "jpg", "svg", "eps"]);
let uploads: Promise<unknown> = Promise.resolve();

/** A file the helper sent after a save: uploaded over the project's copy, one at a time, in the order sent. */
function onChanged(notice: Extract<PageNotice, { kind: "changed" }>) {
  const project = projectId();
  const name = nameOf(notice.path);
  if (notice.project !== project || !opened.has(`${project}/${dirOf(notice.path)}`)) return;
  if (!/^[A-Za-z0-9 ._-]{1,150}$/.test(name) || !UPLOADABLE.has(extensionOf(name))) return;
  uploads = uploads.then(async () => {
    const tree = fileTree();
    if (!tree) throw new Error("could not read this project's files");
    const bytes = fromBase64(notice.data);
    const view = editorView();
    const openId = openDocId();
    if (extensionOf(name) === "tex" && view && openId && pathOf(tree, openId) === notice.path) {
      // Open in the editor: changed there, as an edit, so Overleaf does not warn that it changed elsewhere.
      const text = new TextDecoder().decode(bytes);
      const current = view.state.doc.toString();
      if (text !== current) {
        let start = 0;
        while (start < current.length && start < text.length && current[start] === text[start]) start += 1;
        let end = 0;
        while (end < current.length - start && end < text.length - start && current[current.length - 1 - end] === text[text.length - 1 - end]) end += 1;
        view.dispatch({ changes: { from: start, to: current.length - end, insert: text.slice(start, text.length - end) }, userEvent: "input.reactio" });
      }
    } else {
      await uploadFile(project, tree._id, notice.path, bytes);
    }
    if (extensionOf(name) === "tex") {
      toast(`Reactio: ${notice.path} updated from Reactio Draw. Recompile to see it in the PDF.`, "success");
      // Overleaf's file tree learns of the new files a moment later; then the Visual preview draws them.
      for (const wait of [1500, 4000]) setTimeout(() => editorView()?.dispatch({}), wait);
    }
  }).catch((error) => toast(`Reactio: could not update ${notice.path}: ${(error as Error).message}`, "error"));
}

export function startEditing() {
  window.addEventListener("message", (event: MessageEvent) => {
    const data = event.data as Envelope | undefined;
    if (event.source !== window || data?.channel !== CHANNEL || data.to !== "page") return;
    const body = data.body;
    if (body.kind === "changed") onChanged(body);
    else if (body.requestId) answers.get(body.requestId)?.(body);
  });
  document.addEventListener("dblclick", (event) => {
    const target = event.target as Element | null;
    // The Visual editor's picture opens its drawing itself.
    if (!target?.closest?.(".cm-content") || target.closest(".reactio-visual-figure")) return;
    void editFigureAt(event).catch((error) => toast(`Reactio: ${(error as Error).message}`, "error"));
  }, true);
}
