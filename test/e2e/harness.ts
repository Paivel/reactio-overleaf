// A stand-in for Overleaf's editor page: a real CodeMirror 6 view, the store
// Overleaf exposes to extensions, its hook for extensions' CodeMirror parts,
// and the file tree and compile output where React keeps them.
import { Compartment, EditorSelection, EditorState, StateEffect, StateField, Prec, ChangeSet } from "@codemirror/state";
import { EditorView, ViewPlugin, hoverTooltip, keymap, Decoration, WidgetType } from "@codemirror/view";
import { autocompletion } from "@codemirror/autocomplete";

const mode = location.search.slice(1).replace(/&visual$/, "");
const visual = location.search.endsWith("&visual");
const docs: Record<string, string> = {
  edit: "\\documentclass{achemso}\n\\begin{document}\n\\begin{scheme}\n\t\\input{figures/scheme}\n\\end{scheme}\n\\end{document}\n",
  compounds: "\\documentclass{achemso}\n\\begin{document}\n\\begin{scheme}\n\t\\input{figures/scheme}\n\t\\caption{Synthesis}\n\t\\label{sch:one}\n\\end{scheme}\nThe ketone \n\\end{document}\n",
  paste: "\\documentclass{achemso}\n\\usepackage{chemnum}\n\\begin{document}\nIntro.\n\n\\end{document}\n",
};
const doc = docs[mode] ?? docs.paste;
const figures = mode === "paste" || !mode
  ? { _id: "f1", name: "figures", folders: [], docs: [], fileRefs: [{ _id: "x", name: "scheme.pdf" }] }
  : { _id: "f1", name: "figures", folders: [], docs: [{ _id: "d2", name: "scheme.tex" }], fileRefs: [{ _id: "x1", name: "scheme.reactio" }, { _id: "x2", name: "scheme.pdf" }] };
const tree = { _id: "aaaaaaaaaaaaaaaaaaaaaaaa", name: "rootFolder", folders: [figures], docs: [{ _id: "d", name: "main.tex" }], fileRefs: [] };

// Overleaf's hook (third-party-extensions.ts): extensions gathered from an event, again on `editor:extension-loaded`.
const CodeMirror = { ChangeSet, Decoration, EditorSelection, EditorView, Prec, StateEffect, StateField, ViewPlugin, WidgetType, hoverTooltip, keymap };
const third = new Compartment();
const gather = () => {
  const extensions: unknown[] = [];
  window.dispatchEvent(new CustomEvent("UNSTABLE_editor:extensions", { detail: { CodeMirror, extensions } }));
  return extensions as never[];
};
const view = new EditorView({ state: EditorState.create({ doc, extensions: [autocompletion({ icons: false }), third.of(gather())] }), parent: document.getElementById("editor")! });
window.addEventListener("editor:extension-loaded", () => view.dispatch({ effects: third.reconfigure(gather()) }));

const store = new Map<string, unknown>([["editor.view", view], ["editor.open_doc_name", "main.tex"], ["editor.open_doc_id", "d"], ["editor.showVisual", visual]]);
(window as any).overleaf = { unstable: { store: { get: (path: string) => store.get(path) } } };
const fileList = { top: [], other: [{ path: "output.aux", url: "/project/0123456789abcdef01234567/build/b1/output/output.aux?clsiserverid=c1" }] };
// What React puts on its elements: the fiber, whose ancestors hold the context values.
(view.dom as any).__reactFiber$test = { memoizedProps: {}, return: { memoizedProps: { value: { fileTreeData: tree } }, return: { memoizedProps: { value: { fileList } }, return: null } } };
(window as any).testView = view;
(window as any).testStore = store;

// A PDF preview page as PDF.js lays it out, and Overleaf's double click asking SyncTeX.
if (mode === "compounds" || mode === "edit") {
  const viewer = document.createElement("div");
  viewer.className = "pdfViewer";
  viewer.style.cssText = "position:absolute;left:700px;top:20px;--scale-factor:1";
  viewer.innerHTML = `<div class="page" data-page-number="1" style="position:relative;width:400px;height:300px;border:1px solid #ccc"><div class="textLayer" style="position:absolute;inset:0"></div></div>`;
  document.body.append(viewer);
  const layer = viewer.querySelector(".textLayer")!;
  setTimeout(() => {
    layer.innerHTML = `<span style="position:absolute;left:100px;top:100px;font:bold 16px serif">1</span><span style="position:absolute;left:200px;top:100px;font:bold 16px serif">2a</span><span style="position:absolute;left:190px;top:270px;font:14px serif">1</span>`;
  }, 2500);
  layer.addEventListener("dblclick", (event: Event) => {
    const e = event as MouseEvent;
    (window as unknown as { overleafSynced: number }).overleafSynced = ((window as unknown as { overleafSynced?: number }).overleafSynced ?? 0) + 1;
    void fetch(`/project/0123456789abcdef01234567/sync/pdf?page=1&h=${e.offsetX}&v=${e.offsetY}`).then((r) => r.json()).then((answer) => { (window as unknown as { overleafAnswer: unknown }).overleafAnswer = answer; });
  });
}
