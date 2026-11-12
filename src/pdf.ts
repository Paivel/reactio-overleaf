/**
 * The PDF preview: Cmd and a double click on a figure opens its drawing in Reactio
 * Draw, and compound numbers set over a drawing are outlined; a click on one
 * copies the LaTeX that cites it.
 *
 * Both use SyncTeX, as Overleaf does: `/project/<id>/sync/pdf` says where in
 * the source a point of the PDF comes from; for numbers, this asks it for each run of
 * text that reads as a compound's number, and keeps those whose source line
 * names a compound the last compile gave that number.
 */
import { compoundCommand, compoundKeysOnLine, keysNumbered, printedNumber } from "./lattice/compound-keys";
import { compiledAuxUrl, compoundProject } from "./compounds";
import { figureAtSource, openDrawing } from "./edit";
import { downloadDoc, editorView, fileTree, openDocId, projectId } from "./overleaf";
import { entityAt, pathOf } from "./plan";
import { toast } from "./toast";

type SyncAnswer = { code?: { file: string; line: number }[] };

/**
 * Cmd (Ctrl on Windows) and a double click on a figure in the PDF opens its
 * drawing, and only that. Overleaf asks SyncTeX itself, as for any double
 * click; this reads the real answer and, when it lands on a figure, hands
 * Overleaf one that keeps the editor where it is, so it does not go to the
 * source. A plain double click is left to Overleaf.
 */
let cmdDoubleClick = 0;

function watchDoubleClicks() {
  document.addEventListener("dblclick", (event) => {
    if (!(event.metaKey || event.ctrlKey)) return;
    if (!(event.target as Element | null)?.closest?.(".pdfViewer, .pdf-viewer")) return;
    cmdDoubleClick = Date.now();
    // Overleaf would select the word clicked in the editor.
    window.getSelection()?.removeAllRanges();
  }, true);
  const original = window.fetch;
  window.fetch = async function (this: unknown, ...args: Parameters<typeof fetch>) {
    const url = typeof args[0] === "string" ? args[0] : args[0] instanceof URL ? args[0].href : (args[0] as Request).url;
    if (!(/\/project\/[0-9a-f]{24}\/sync\/pdf\?/.test(url) && Date.now() - cmdDoubleClick < 3000)) return original.apply(this, args);
    cmdDoubleClick = 0;
    const response = await original.apply(this, args);
    try {
      const answer = (await response.clone().json()) as SyncAnswer;
      const place = answer.code?.[0];
      const project = projectId();
      const tree = fileTree();
      console.info("[Reactio for Overleaf] Cmd double click", { url, place });
      const figure = place && project && tree ? await figureAtSource(project, tree, place.file, place.line) : null;
      if (!figure || !project || !tree) {
        toast(place ? `Reactio: no Reactio Draw figure at ${place.file}:${place.line}` : "Reactio: SyncTeX found nothing there. Compile, then try again.", "info");
        return response;
      }
      void openDrawing(project, tree, figure.source);
      const here = whereTheCaretIs(tree);
      if (!here) return response;
      return new Response(JSON.stringify({ ...answer, code: [here] }), { status: 200, headers: { "content-type": "application/json" } });
    } catch {
      return response;
    }
  } as typeof fetch;
}

/** The open file and the caret's line, for an answer that leaves the editor as it is. */
function whereTheCaretIs(tree: NonNullable<ReturnType<typeof fileTree>>): { file: string; line: number; column: number } | null {
  const view = editorView() as unknown as { state: { selection: { main: { head: number } }; doc: { lineAt(pos: number): { number?: number } } } } | null;
  const id = openDocId();
  const file = id ? pathOf(tree, id) : null;
  const line = view?.state.doc.lineAt(view.state.selection.main.head).number;
  return file && line ? { file, line, column: 0 } : null;
}

// ---- Compound numbers in the PDF.

/** The parameters every SyncTeX request of the last compile carries, read from its output files' address. */
function syncParams(): URLSearchParams | null {
  const aux = compiledAuxUrl();
  if (!aux) return null;
  const url = new URL(aux, location.origin);
  const params = new URLSearchParams();
  const build = /\/build\/([^/]+)\//.exec(url.pathname)?.[1];
  for (const name of ["clsiserverid", "editorId"]) {
    const value = url.searchParams.get(name);
    if (value) params.set(name, value);
  }
  if (build) params.set("buildId", build);
  return params;
}

const syncCache = new Map<string, Promise<{ file: string; line: number } | null>>();

/** Where a point of a page comes from in the source, in PDF points from the page's top left. */
function syncFromPdf(project: string, page: number, h: number, v: number): Promise<{ file: string; line: number } | null> {
  const params = syncParams();
  if (!params) return Promise.resolve(null);
  params.set("page", String(page));
  params.set("h", h.toFixed(2));
  params.set("v", v.toFixed(2));
  const key = params.toString();
  let found = syncCache.get(key);
  if (!found) {
    found = fetch(`/project/${project}/sync/pdf?${params}`, { credentials: "same-origin" })
      .then((response) => (response.ok ? response.json() : null))
      .then((answer: SyncAnswer | null) => answer?.code?.[0] ?? null)
      .catch(() => null);
    syncCache.set(key, found);
  }
  return found;
}

const lineCache = new Map<string, Promise<string[]>>();

async function sourceLines(project: string, file: string): Promise<string[]> {
  const path = file.replace(/^\.?\/+/, "");
  let lines = lineCache.get(path);
  if (!lines) {
    const tree = fileTree();
    const doc = tree && entityAt(tree, path);
    lines = doc?.type === "doc" ? downloadDoc(project, doc.id).then((text) => text.split(/\r?\n/)).catch(() => []) : Promise.resolve([]);
    lineCache.set(path, lines);
    setTimeout(() => lineCache.delete(path), 15_000);
  }
  return lines;
}

/** The scale of a page: CSS pixels per PDF point. */
function pageScale(page: HTMLElement): number {
  const factor = parseFloat(getComputedStyle(page).getPropertyValue("--scale-factor")) || parseFloat(getComputedStyle(page.closest(".pdfViewer") ?? page).getPropertyValue("--scale-factor"));
  return factor > 0 ? factor : 96 / 72;
}

const MARKED = "reactioCompound";
const MAX_CHECKS_PER_PAGE = 80;

/** Outlines the runs of text on a page that are compound numbers. */
async function markPage(textLayer: HTMLElement) {
  const project = projectId();
  const page = textLayer.closest<HTMLElement>(".page");
  const pageNumber = Number(page?.dataset.pageNumber);
  if (!project || !page || !pageNumber) return;
  const { numbers } = await compoundProject();
  if (!numbers.size) return;
  const printed = new Set(numbers.values());
  const spans = [...textLayer.querySelectorAll<HTMLElement>("span")]
    .filter((span) => !span.dataset[MARKED] && span.childElementCount === 0 && printed.has(printedNumber(span.textContent ?? "")))
    .slice(0, MAX_CHECKS_PER_PAGE);
  const scale = pageScale(page);
  const pageBox = page.getBoundingClientRect();
  await Promise.all(spans.map(async (span) => {
    span.dataset[MARKED] = "checked";
    const box = span.getBoundingClientRect();
    const h = (box.left + box.width / 2 - pageBox.left - page.clientLeft) / scale;
    const v = (box.top + box.height / 2 - pageBox.top - page.clientTop) / scale;
    const source = await syncFromPdf(project, pageNumber, h, v);
    if (!source) return;
    const lines = await sourceLines(project, source.file);
    const near = [lines[source.line - 1], lines[source.line - 2], lines[source.line]].filter(Boolean).join("\n");
    const keys = keysNumbered(span.textContent ?? "", near.split("\n").flatMap(compoundKeysOnLine), numbers);
    if (!keys.length) return;
    const key = keys[0];
    const marks = /\\rcmpd\s*\{/.test(near) ? new Set(near.match(/\\rcmpd\s*\{([^{}]*)\}/g)?.map((mark) => mark.slice(mark.indexOf("{") + 1, -1).trim())) : new Set<string>();
    const command = compoundCommand(key, marks.has(key));
    span.dataset[MARKED] = "compound";
    span.title = `${command}: click to copy`;
    // Outlined only under the pointer, so the PDF reads as it will print.
    span.style.cssText += ";border-radius:2px;cursor:copy";
    span.addEventListener("mouseenter", () => { span.style.outline = "2px solid rgba(31,111,235,.75)"; span.style.background = "rgba(31,111,235,.12)"; });
    span.addEventListener("mouseleave", () => { span.style.outline = ""; span.style.background = ""; });
    span.addEventListener("click", (event) => {
      event.stopPropagation();
      void navigator.clipboard.writeText(command).then(
        () => toast(`Reactio: copied ${command}`, "success"),
        () => toast(`Reactio: could not copy ${command}`, "error"),
      );
    });
  }));
}

function watchTextLayers() {
  let timer = 0;
  const pending = new Set<HTMLElement>();
  const observer = new MutationObserver((records) => {
    for (const record of records) {
      for (const node of record.addedNodes) {
        if (!(node instanceof HTMLElement)) continue;
        const layer = node.classList.contains("textLayer") ? node : node.closest?.(".textLayer") ?? node.querySelector?.(".textLayer");
        if (layer instanceof HTMLElement) pending.add(layer);
      }
    }
    if (!pending.size) return;
    clearTimeout(timer);
    timer = window.setTimeout(() => {
      const layers = [...pending];
      pending.clear();
      for (const layer of layers) if (layer.isConnected) void markPage(layer).catch(() => undefined);
    }, 400);
  });
  observer.observe(document.body, { childList: true, subtree: true });
}

export function startPdf() {
  watchDoubleClicks();
  watchTextLayers();
  // Pages already shown when this loaded.
  setTimeout(() => {
    for (const layer of document.querySelectorAll<HTMLElement>(".textLayer")) void markPage(layer).catch(() => undefined);
  }, 1500);
}
