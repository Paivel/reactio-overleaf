import { describe, expect, it } from "vitest";
import { FigureError, planFigure, type TreeFolder } from "../src/plan";
import { pasteChanges } from "../src/content-parts";

const b64 = (text: string) => btoa(text);
const folder = (name: string, files: string[] = [], folders: TreeFolder[] = []): TreeFolder => ({
  _id: `id-${name}`, name, folders, docs: files.filter((file) => file.endsWith(".tex")).map((file) => ({ _id: file, name: file })),
  fileRefs: files.filter((file) => !file.endsWith(".tex")).map((file) => ({ _id: file, name: file })),
});
const manifest = {
  version: 1,
  source: { name: "scheme.reactio", data: b64("{}") },
  outputs: [{ name: "scheme.pdf", data: b64("%PDF") }, { name: "scheme.tex", data: b64("% editable-figure source: scheme.reactio\n\\includegraphics{scheme.pdf}") }],
  entry: "scheme.tex",
  packages: ["graphicx"],
};
const text = (bytes: Uint8Array) => new TextDecoder().decode(bytes);

describe("planFigure", () => {
  it("puts the files in figures/, the entry last", () => {
    const plan = planFigure(folder("root", ["main.tex"]), manifest, "figures");
    expect(plan.files.map((file) => file.path)).toEqual(["figures/scheme.reactio", "figures/scheme.pdf", "figures/scheme.tex"]);
    expect(plan.figure).toMatchObject({ directory: "figures", entry: "scheme.tex", source: "figures/scheme.reactio" });
  });

  it("renames the whole set when a name is taken, and the entry's references with it", () => {
    const root = folder("root", ["main.tex"], [folder("figures", ["scheme.pdf"])]);
    const plan = planFigure(root, manifest, "figures");
    expect(plan.files.map((file) => file.name)).toEqual(["scheme-2.reactio", "scheme-2.pdf", "scheme-2.tex"]);
    expect(text(plan.files[2].bytes)).toBe("% editable-figure source: scheme-2.reactio\n\\includegraphics{scheme-2.pdf}");
  });

  it("counts names in the project root, which LaTeX searches too, case aside", () => {
    const plan = planFigure(folder("root", ["Scheme.PDF"]), manifest, "figures");
    expect(plan.figure.entry).toBe("scheme-2.tex");
  });

  it("refuses a file where the figures folder should be", () => {
    expect(() => planFigure(folder("root", ["figures"]), manifest, "figures")).toThrow(FigureError);
  });

  it("refuses names that are paths, and file types figures are not made of", () => {
    expect(() => planFigure(folder("root"), { ...manifest, source: { name: "../x.reactio", data: "" } }, "figures")).toThrow(FigureError);
    expect(() => planFigure(folder("root"), { ...manifest, outputs: [...manifest.outputs, { name: "run.sh", data: "" }] }, "figures")).toThrow(FigureError);
  });
});

describe("pasteChanges", () => {
  const figure = { directory: "figures", entry: "scheme.tex", source: "figures/scheme.reactio", packages: ["graphicx"] };
  const doc = "\\documentclass{article}\n\\begin{document}\n\n\\end{document}\n";
  const apply = (source: string, changes: { from: number; to?: number; insert: string }[]) => [...changes]
    .map((change, order) => ({ ...change, order }))
    .sort((a, b) => b.from - a.from || b.order - a.order)
    .reduce((out, change) => out.slice(0, change.from) + change.insert + out.slice(change.to ?? change.from), source);

  it("puts a float on an empty line of the body, and what the preamble lacks", () => {
    const at = doc.indexOf("\n\n") + 1;
    const { changes, caretInInsert } = pasteChanges(doc, { from: at, to: at }, figure, true);
    const out = apply(doc, changes);
    expect(out).toContain("\\usepackage{graphicx}\n\\graphicspath{{figures/}}\n\\begin{document}");
    expect(out).toContain("\\begin{figure}\n\t\\centering\n\t\\input{figures/scheme}\n\t\\caption{}\n\t\\label{fig:scheme}\n\\end{figure}");
    expect(changes[0].insert.slice(caretInInsert, caretInInsert + 1)).toBe("}");
  });

  it("uses a scheme float in an ACS document", () => {
    const acs = doc.replace("article", "achemso");
    const at = acs.indexOf("\n\n") + 1;
    expect(pasteChanges(acs, { from: at, to: at }, figure, true).changes[0].insert).toMatch(/^\\begin\{scheme\}[\s\S]*\\label\{sch:scheme\}/);
  });

  it("puts only the include line inside text, and names the preamble lines for another file", () => {
    const { changes, unplaced } = pasteChanges("See ", { from: 4, to: 4 }, figure, true);
    expect(changes).toEqual([{ from: 4, to: 4, insert: "\\input{figures/scheme}" }]);
    expect(unplaced).toEqual(["\\usepackage{graphicx}", "\\graphicspath{{figures/}}"]);
  });
});
