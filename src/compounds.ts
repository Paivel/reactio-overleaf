/**
 * Compound marks in Overleaf, as reactio-latex shows them in VS Code: typing
 * `\rcmpd{` or `\cmpd{` lists the project's compounds with the numbers the
 * last compile gave them and the scheme each is drawn in; resting the pointer
 * on one shows its number; and the Compounds panel finds a compound by the
 * number seen in the PDF and puts the exact LaTeX that cites it at the caret.
 */
import { parseAux, type CompiledLabel } from "./lattice/compiled-labels";
import { numberedKey, parseCompoundNumbers } from "./lattice/compound-keys";
import { compoundPlaces, placeLine } from "./lattice/compound-places";
import { compoundRows, rowsForNumber, type CompoundRow } from "./compound-list";
import { compoundKeyAt, compoundSlot, markInsertion } from "./compound-text";
import { downloadDoc, editorView, fileTree, openDocId, projectId, reactValue, type EditorViewLike } from "./overleaf";
import type { TreeFolder } from "./plan";
import { visualFigures } from "./visual";

export type CompoundProject = { rows: CompoundRow[]; numbers: Map<string, string>; compiled: boolean };

/** Docs read at most this often; the open one is always read from the editor. */
const FRESH_MS = 15_000;
const MAX_DOCS = 300;

const docCache = new Map<string, { at: number; text: Promise<string> }>();
let auxCache: { url: string; text: Promise<string> } | null = null;

function allDocs(folder: TreeFolder, prefix = ""): { id: string; path: string }[] {
  return [
    ...folder.docs.filter((doc) => /\.(?:tex|ltx|sty|cls)$/i.test(doc.name)).map((doc) => ({ id: doc._id, path: `${prefix}${doc.name}` })),
    ...folder.folders.flatMap((child) => allDocs(child, `${prefix}${child.name}/`)),
  ];
}

/** The `.aux` of the last compile, from the output files the PDF preview holds. */
export function compiledAuxUrl(): string | null {
  const list = reactValue<{ top?: { path: string; url: string }[]; other?: { path: string; url: string }[] }>("fileList", (value) => Boolean(value && typeof value === "object" && ("top" in value || "other" in value)));
  const file = [...(list?.top ?? []), ...(list?.other ?? [])].find((item) => item.path === "output.aux");
  return file?.url ?? null;
}

async function auxText(): Promise<string> {
  const url = compiledAuxUrl();
  if (!url) return "";
  if (auxCache?.url !== url) {
    auxCache = {
      url,
      text: fetch(url, { credentials: "same-origin" }).then((response) => (response.ok ? response.text() : "")).catch(() => ""),
    };
  }
  return auxCache.text;
}

/** Reads the project's sources and the last compile's numbers. */
export async function compoundProject(): Promise<CompoundProject> {
  const project = projectId();
  const tree = fileTree();
  if (!project || !tree) return { rows: [], numbers: new Map(), compiled: false };
  const view = editorView();
  const openId = openDocId();
  const now = Date.now();
  const sources = await Promise.all(allDocs(tree).slice(0, MAX_DOCS).map(async ({ id, path }) => {
    if (id === openId && view) return { path, text: view.state.doc.toString() };
    let cached = docCache.get(id);
    if (!cached || now - cached.at > FRESH_MS) {
      cached = { at: now, text: downloadDoc(project, id).catch(() => "") };
      docCache.set(id, cached);
    }
    return { path, text: await cached.text };
  }));
  const aux = await auxText();
  const numbers = parseCompoundNumbers(aux);
  const labels: Map<string, CompiledLabel> | null = aux ? parseAux(aux).labels : null;
  const places = new Map([...compoundPlaces(sources)].map(([key, place]) => [key, placeLine(place, labels, numbers)]));
  return { rows: compoundRows(sources.map((source) => source.text), numbers, places), numbers, compiled: Boolean(aux) };
}

// ---- Completion and hover, added to Overleaf's editor through its extension hook.

type Completion = { label: string; detail?: string; info?: string; apply?: string | ((view: EditorViewLike, completion: Completion, from: number, to: number) => void); type?: string; boost?: number };
type CompletionContext = { state: { doc: { lineAt(pos: number): { from: number; text: string } } }; pos: number; explicit: boolean };

/** Completion of compound keys after `\rcmpd{` and `\cmpd{…,`. */
export async function completeCompound(context: CompletionContext) {
  const line = context.state.doc.lineAt(context.pos);
  const slot = compoundSlot(line.text.slice(0, context.pos - line.from));
  if (!slot) return null;
  const { rows } = await compoundProject();
  const options: Completion[] = rows.map((row) => {
    const swap = markInsertion(slot, row.key);
    const option: Completion = { label: row.key, detail: row.number ? `${row.number}` : "not compiled yet", info: row.place, type: "compound" };
    if (swap) {
      // A drawing's mark after `\cmpd{`: the command becomes `\rcmpd{`, which it needs.
      option.apply = (view, _completion, _from, to) => view.dispatch({ changes: { from: line.from + swap.from, to, insert: swap.insertText }, selection: { anchor: line.from + swap.from + swap.insertText.length } });
    }
    return option;
  });
  return { from: line.from + slot.from, options, validFor: /^[^{}\\%,]*$/ };
}

type CodeMirrorExports = {
  StateEffect: { appendConfig: { of(value: unknown): unknown } };
  ViewPlugin: { define(create: (view: EditorViewLike) => unknown): unknown };
  hoverTooltip: (source: (view: EditorViewLike, pos: number) => unknown) => unknown;
};

/** The number and scheme of the compound under the pointer. */
function hoverSource(view: EditorViewLike, pos: number) {
  const line = view.state.doc.lineAt(pos) as { from: number; text: string };
  const found = compoundKeyAt(line.text, pos - line.from);
  if (!found) return null;
  return {
    pos: line.from + found.from,
    end: line.from + found.to,
    above: true,
    create: () => {
      const dom = document.createElement("div");
      dom.style.cssText = "padding:4px 8px;font:13px/1.4 system-ui,sans-serif;max-width:420px";
      dom.textContent = "…";
      void compoundProject().then(({ rows, numbers, compiled }) => {
        const row = rows.find((item) => item.key === found.key);
        const number = numbers.get(numberedKey(found.key));
        dom.textContent = [
          number ? `Compound ${number}` : compiled ? "Not numbered in the last compile" : "Compile to see its number",
          row?.place ?? "",
        ].filter(Boolean).join(" · ");
      });
      return { dom };
    },
  };
}

let installed = false;
const completionSource = (context: CompletionContext) => completeCompound(context);

/** Adds completion and hover to the editor, now and each time Overleaf builds it again. */
export function installEditorParts() {
  if (installed) return;
  installed = true;
  window.addEventListener("UNSTABLE_editor:extensions", (event) => {
    const { CodeMirror, extensions } = (event as CustomEvent<{ CodeMirror: CodeMirrorExports; extensions: unknown[] }>).detail;
    extensions.push(CodeMirror.hoverTooltip(hoverSource));
    extensions.push(visualFigures(CodeMirror as never));
    extensions.push(CodeMirror.ViewPlugin.define((view) => {
      // `languageData` is a facet of EditorState, which Overleaf does not export: it comes from the view's state.
      setTimeout(() => {
        const state = view.state as unknown as { constructor: { languageData: { of(value: unknown): unknown } }; languageDataAt(name: string, pos: number): unknown[] };
        if (state.languageDataAt("autocomplete", 0).includes(completionSource)) return;
        view.dispatch({ effects: CodeMirror.StateEffect.appendConfig.of(state.constructor.languageData.of(() => [{ autocomplete: completionSource }])) });
      }, 0);
      return {};
    }));
  });
  // The editor may be there already: ask Overleaf to gather extensions again.
  window.dispatchEvent(new CustomEvent("editor:extension-loaded"));
}

// ---- The Compounds panel.

let panel: HTMLElement | null = null;

function insertAtCaret(text: string) {
  const view = editorView();
  if (!view) return;
  const { from, to } = view.state.selection.main;
  view.dispatch({ changes: { from, to, insert: text }, selection: { anchor: from + text.length } });
  view.focus();
}

async function renderRows(list: HTMLElement, status: HTMLElement, query: string) {
  status.textContent = "Reading the project…";
  const { rows, compiled } = await compoundProject();
  const shown = /^\s*[0-9A-Za-z.()-]*\s*$/.test(query) && /\d/.test(query) ? rowsForNumber(rows, query) : rows.filter((row) => row.key.toLowerCase().includes(query.trim().toLowerCase()));
  list.replaceChildren(...shown.slice(0, 200).map((row) => {
    const item = document.createElement("button");
    item.type = "button";
    item.title = `Insert ${row.command} at the caret (also copied)`;
    item.style.cssText = "display:grid;grid-template-columns:3.5em 1fr;gap:2px 8px;width:100%;text-align:left;border:0;border-bottom:1px solid #eaeef2;background:none;padding:6px 8px;cursor:pointer;font:inherit;color:inherit";
    const number = document.createElement("b");
    number.textContent = row.number ?? "–";
    const command = document.createElement("code");
    command.textContent = row.command;
    const place = document.createElement("span");
    place.textContent = row.place ?? "";
    place.style.cssText = "grid-column:2;color:#59636e;font-size:12px";
    item.append(number, command, place);
    item.onclick = () => {
      insertAtCaret(row.command);
      void navigator.clipboard?.writeText(row.command).catch(() => undefined);
    };
    return item;
  }));
  status.textContent = !rows.length ? "No compounds in this project yet." : compiled ? `${shown.length} of ${rows.length} compounds` : "Compile the document to see the numbers.";
}

export function togglePanel() {
  if (panel) {
    panel.remove();
    panel = null;
    return;
  }
  panel = document.createElement("div");
  panel.id = "reactio-overleaf-compounds";
  panel.style.cssText = "position:fixed;right:16px;bottom:64px;z-index:2147483646;width:min(380px,calc(100vw - 32px));max-height:60vh;display:flex;flex-direction:column;background:#fff;color:#1f2328;border-radius:8px;box-shadow:0 8px 28px rgba(0,0,0,.25);font:13px/1.4 system-ui,sans-serif;overflow:hidden";
  const head = document.createElement("div");
  head.style.cssText = "display:flex;gap:8px;align-items:center;padding:8px;border-bottom:1px solid #d0d7de";
  const search = document.createElement("input");
  search.placeholder = "Number in the PDF (2a) or key";
  search.style.cssText = "flex:1;padding:4px 6px;border:1px solid #d0d7de;border-radius:4px;font:inherit";
  const close = document.createElement("button");
  close.textContent = "×";
  close.title = "Close";
  close.style.cssText = "border:0;background:none;font-size:18px;cursor:pointer;color:inherit";
  close.onclick = togglePanel;
  head.append(search, close);
  const list = document.createElement("div");
  list.style.cssText = "overflow:auto;flex:1";
  const status = document.createElement("div");
  status.style.cssText = "padding:6px 8px;color:#59636e;font-size:12px;border-top:1px solid #d0d7de";
  panel.append(head, list, status);
  document.body.append(panel);
  let timer = 0;
  search.oninput = () => {
    clearTimeout(timer);
    timer = window.setTimeout(() => void renderRows(list, status, search.value), 150);
  };
  search.onkeydown = (event) => {
    if (event.key === "Escape") togglePanel();
    if (event.key === "Enter") (list.querySelector("button") as HTMLButtonElement | null)?.click();
  };
  void renderRows(list, status, "");
  search.focus();
}

/** A small button that opens the panel, and Ctrl+Shift+K (Cmd+Shift+K on a Mac) for it. */
export function installPanelButton() {
  const button = document.createElement("button");
  button.id = "reactio-overleaf-compounds-button";
  button.type = "button";
  button.textContent = "Compounds";
  button.title = "Find a compound by its number (Ctrl+Shift+K)";
  button.style.cssText = "position:fixed;right:16px;bottom:16px;z-index:2147483645;padding:6px 10px;border-radius:16px;border:1px solid #d0d7de;background:#fff;color:#1f2328;box-shadow:0 2px 8px rgba(0,0,0,.15);font:12px system-ui,sans-serif;cursor:pointer;opacity:.85";
  button.onclick = togglePanel;
  document.body.append(button);
  window.addEventListener("keydown", (event) => {
    if ((event.ctrlKey || event.metaKey) && event.shiftKey && event.key.toLowerCase() === "k") {
      event.preventDefault();
      togglePanel();
    }
  }, true);
}

