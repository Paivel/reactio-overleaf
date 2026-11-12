/**
 * Overleaf's Visual editor shows `\includegraphics` as its picture but a
 * pasted figure's `\input{figures/…}` as code. This shows the figure's PDF in
 * its place, with the compound numbers its .tex sets over it. In a float laid
 * out as a paste makes it, the `\begin`, `\centering`, include and `\end` lines
 * give way to the picture and the caption and label stay under it. The
 * picture takes no clicks, so the caret stays out and a double click opens the
 * drawing in Reactio Draw at once; the code is in Overleaf's Code editor.
 */
import { includedTexPaths } from "./lattice/editable-figure";
import { downloadFile, fileTree, openDocId, projectId, type EditorViewLike } from "./overleaf";
import { DRAWING_EXTENSIONS, entityAt, extensionOf, folderAt, pathOf, type TreeFolder } from "./plan";
import { openDrawing } from "./edit";
import { renderFirstPage } from "./pdf-render";
import { overlayNodes } from "./figure-overlay";
import { compiledAuxUrl, compoundProject } from "./compounds";
import { downloadDoc } from "./overleaf";
import { floatAround } from "./float-layout";

type Line = { from: number; to: number; text: string; number: number };
type StateForVisual = { doc: { lines: number; line(n: number): Line } };
type Transaction = { docChanged: boolean; state: StateForVisual; changes: unknown; effects: readonly { is(type: unknown): boolean }[] };
type DecorationSet = { map(changes: unknown): DecorationSet };

type CodeMirrorParts = {
  Decoration: {
    replace(spec: { widget: unknown; block?: boolean }): { range(from: number, to: number): unknown };
    none: DecorationSet;
    set(ranges: unknown[], sort?: boolean): DecorationSet;
  };
  WidgetType: new () => object;
  EditorView: { decorations: { from(field: unknown): unknown } };
  StateField: { define(spec: { create(state: StateForVisual): DecorationSet; update(value: DecorationSet, tr: Transaction): DecorationSet; provide(field: unknown): unknown }): unknown };
  StateEffect: { define(): { of(value: null): unknown } };
  ViewPlugin: { define(create: (view: { dispatch(spec: unknown): void }) => { update?(update: { docChanged: boolean }): void; destroy?(): void }): unknown };
};

const INCLUDE = /^(\s*)(\\(?:input|include)\{[^{}]+\}|\\(?:sub)?import\{[^{}]*\}\{[^{}]+\})\s*(%.*)?$/;

/** A figure is an entry `.tex` with a `.pdf` of the same name and a drawing beside it. */
export function figureAt(tree: TreeFolder, entry: string): { entryId: string; pdf: { id: string; path: string }; source: string | null } | null {
  const doc = entityAt(tree, entry);
  if (doc?.type !== "doc") return null;
  const folderPath = entry.includes("/") ? entry.slice(0, entry.lastIndexOf("/")) : "";
  const folder = folderAt(tree, folderPath);
  const stem = entry.slice(entry.lastIndexOf("/") + 1).replace(/\.tex$/i, "");
  const pdf = folder?.fileRefs.find((file) => file.name === `${stem}.pdf`);
  if (!folder || !pdf) return null;
  const prefix = folderPath ? `${folderPath}/` : "";
  const drawing = folder.fileRefs.find((file) => file.name.startsWith(`${stem}.`) && DRAWING_EXTENSIONS.includes(extensionOf(file.name)));
  return { entryId: doc.id, pdf: { id: pdf._id, path: `${prefix}${pdf.name}` }, source: drawing ? `${prefix}${drawing.name}` : null };
}

const pdfBytes = new Map<string, Promise<Uint8Array>>();

function pdfOf(project: string, fileId: string): Promise<Uint8Array> {
  let bytes = pdfBytes.get(fileId);
  if (!bytes) {
    bytes = downloadFile(project, fileId);
    bytes.catch(() => pdfBytes.delete(fileId));
    pdfBytes.set(fileId, bytes);
  }
  return bytes;
}

function visualOn(): boolean {
  try {
    return Boolean(window.overleaf?.unstable?.store?.get<boolean>("editor.showVisual"));
  } catch {
    return false;
  }
}

export function visualFigures(CodeMirror: CodeMirrorParts): unknown {
  const { Decoration, WidgetType, EditorView, StateField, StateEffect, ViewPlugin } = CodeMirror;

  class FigureWidget extends WidgetType {
    constructor(readonly fileId: string, readonly entry: string, readonly entryId: string, readonly source: string | null, readonly compiled: string, readonly block: boolean) {
      super();
    }

    eq(other: FigureWidget) {
      return other.fileId === this.fileId && other.entry === this.entry && other.compiled === this.compiled && other.block === this.block;
    }

    get estimatedHeight() {
      return this.block ? 200 : -1;
    }

    toDOM() {
      const box = document.createElement(this.block ? "div" : "span");
      box.className = "reactio-visual-figure";
      box.title = this.source ? `${this.entry}: double-click to edit in Reactio Draw` : this.entry;
      box.style.cssText = `display:${this.block ? "block" : "inline-block"};width:100%;max-width:640px;vertical-align:top;margin:4px auto;background:#fff;user-select:none;${this.source ? "cursor:pointer" : ""}`;
      const frame = document.createElement("canvas");
      frame.style.cssText = "display:block;margin:8px;max-width:calc(100% - 16px);height:120px;background:#fff";
      const stage = document.createElement("span");
      stage.style.cssText = "position:relative;display:block;width:fit-content;max-width:100%;margin:0 auto";
      stage.append(frame);
      box.append(stage);
      const project = projectId();
      if (project) {
        // Laid out first, so the width the line gives is known.
        requestAnimationFrame(() => {
          const width = Math.max(200, Math.min(624, (box.clientWidth || 600) - 16));
          void pdfOf(project, this.fileId).then((bytes) => renderFirstPage(bytes, frame, width)).then(
            (size) => this.drawNumbers(project, stage, frame, size),
            () => {
              const note = document.createElement("span");
              note.style.cssText = "display:block;padding:3px 8px;font:12px system-ui,sans-serif;color:#59636e";
              note.textContent = `${this.entry}: the PDF could not be shown`;
              box.append(note);
            },
          );
        });
      }
      // The editor never sees these, so the first click does not move the caret into the code.
      box.addEventListener("mousedown", (event) => event.preventDefault());
      if (this.source) {
        const source = this.source;
        box.addEventListener("dblclick", (event) => {
          event.preventDefault();
          event.stopPropagation();
          const tree = fileTree();
          if (project && tree) void openDrawing(project, tree, source);
        });
      }
      return box;
    }

    /** The texts the figure's .tex sets over its PDF: compound numbers from the last compile (keys before one). */
    async drawNumbers(project: string, stage: HTMLElement, canvas: HTMLCanvasElement, size: { width: number; height: number; scale: number }) {
      const [tex, { numbers }] = await Promise.all([downloadDoc(project, this.entryId).catch(() => ""), compoundProject()]);
      const left = canvas.offsetLeft;
      const top = canvas.offsetTop;
      for (const node of overlayNodes(tex, numbers)) {
        const text = document.createElement("span");
        text.style.cssText = `position:absolute;left:${left + node.x * size.width}px;top:${top + (1 - node.y) * size.height}px;transform:translate(-50%,-80%);white-space:nowrap;line-height:1;color:#000;font-family:Helvetica,Arial,sans-serif;font-size:${node.size * size.scale}px;pointer-events:none`;
        for (const run of node.runs) {
          const part = document.createElement("span");
          part.textContent = run.text;
          if (run.bold) part.style.fontWeight = "bold";
          if (run.italic) part.style.fontStyle = "italic";
          text.append(part);
        }
        stage.append(text);
      }
    }

    ignoreEvent() {
      return true;
    }
  }

  /** Takes the place of a float's `\end` line. */
  class Gone extends WidgetType {
    eq() {
      return true;
    }

    toDOM() {
      const gone = document.createElement("div");
      gone.style.cssText = "height:0;overflow:hidden";
      return gone;
    }

    ignoreEvent() {
      return true;
    }
  }

  function build(state: StateForVisual): DecorationSet {
    if (!visualOn()) return Decoration.none;
    const tree = fileTree();
    if (!tree) return Decoration.none;
    const openId = openDocId();
    const fromPath = (openId && pathOf(tree, openId)) || "main.tex";
    const compiled = compiledAuxUrl() ?? "";
    const { doc } = state;
    let texts: string[] | null = null;
    const lines = () => (texts ??= Array.from({ length: doc.lines }, (_, index) => doc.line(index + 1).text));
    const ranges: unknown[] = [];
    let skipTo = 0;
    for (let number = 1; number <= doc.lines; number += 1) {
      const line = doc.line(number);
      if (line.from < skipTo) continue;
      const match = line.text.includes("\\") ? INCLUDE.exec(line.text) : null;
      if (!match) continue;
      for (const entry of includedTexPaths(match[2], fromPath)) {
        const figure = figureAt(tree, entry);
        if (!figure) continue;
        const float = floatAround(lines(), number - 1);
        if (float) {
          const begin = doc.line(float.begin + 1);
          const end = doc.line(float.end + 1);
          ranges.push(Decoration.replace({ widget: new FigureWidget(figure.pdf.id, entry, figure.entryId, figure.source, compiled, true), block: true }).range(begin.from, line.to));
          ranges.push(Decoration.replace({ widget: new Gone(), block: true }).range(end.from, end.to));
          skipTo = end.to + 1;
        } else {
          const start = line.from + match[1].length;
          ranges.push(Decoration.replace({ widget: new FigureWidget(figure.pdf.id, entry, figure.entryId, figure.source, compiled, false) }).range(start, start + match[2].length));
        }
        break;
      }
    }
    return Decoration.set(ranges, true);
  }

  const refresh = StateEffect.define();

  // Block decorations must come from state, not from a view plugin.
  const figures = StateField.define({
    create: (state) => build(state),
    update(value, tr) {
      if (tr.effects.some((effect) => effect.is(refresh))) return build(tr.state);
      return tr.docChanged ? value.map(tr.changes) : value;
    },
    provide: (field) => EditorView.decorations.from(field),
  });

  /** What a preview depends on outside the text: the mode, the project's files (a figure uploaded again is a new file) and the last compile. */
  const outside = () => {
    if (!visualOn()) return "code";
    const ids: string[] = [];
    const walk = (folder: TreeFolder) => {
      for (const ref of folder.fileRefs) ids.push(ref._id);
      folder.folders.forEach(walk);
    };
    const tree = fileTree();
    if (tree) walk(tree);
    return `${ids.join(",")}|${compiledAuxUrl() ?? ""}|${openDocId() ?? ""}`;
  };

  // Builds again a moment after typing, and when anything outside the text changes.
  const watcher = ViewPlugin.define((view) => {
    let seen = outside();
    let typing = 0;
    const again = () => view.dispatch({ effects: refresh.of(null) });
    const timer = window.setInterval(() => {
      const now = outside();
      if (now !== seen) {
        seen = now;
        again();
      }
    }, 1000);
    // The tree may not be there yet when the editor is first built.
    const first = window.setTimeout(again, 0);
    return {
      update(update) {
        if (!update.docChanged) return;
        clearTimeout(typing);
        typing = window.setTimeout(again, 400);
      },
      destroy() {
        clearInterval(timer);
        clearTimeout(typing);
        clearTimeout(first);
      },
    };
  });

  return [figures, watcher];
}
