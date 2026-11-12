/**
 * The texts a Reactio Draw figure's `.tex` sets over its PDF (compound
 * numbers and the words beside them), read for a preview: each `\node at
 * (x,y) {…}` of its scope, where x and y are fractions of the picture's width
 * and height (y from the bottom), the node's baseline centred on that point.
 */
import { numberedKey } from "./lattice/compound-keys";

export type OverlayRun = { text: string; bold: boolean; italic: boolean };
export type OverlayNode = { x: number; y: number; size: number; runs: OverlayRun[] };

const NODE = /^\s*\\node at \(([-\d.]+),([-\d.]+)\) \{(.*)\};\s*$/;

/** The brace group opening at `at`: its content and the offset past it. */
function group(text: string, at: number): [string, number] | null {
  if (text[at] !== "{") return null;
  let depth = 0;
  for (let index = at; index < text.length; index += 1) {
    if (text[index] === "\\") index += 1;
    else if (text[index] === "{") depth += 1;
    else if (text[index] === "}" && --depth === 0) return [text.slice(at + 1, index), index + 1];
  }
  return null;
}

/** A node's LaTeX as runs of plain text: compounds as their numbers (or keys before a compile), markup gone. */
export function nodeRuns(latex: string, numbers: ReadonlyMap<string, string>, style = { bold: false, italic: false }): OverlayRun[] {
  const runs: OverlayRun[] = [];
  const add = (text: string, bold: boolean, italic: boolean) => {
    if (!text) return;
    const last = runs[runs.length - 1];
    if (last && last.bold === bold && last.italic === italic) last.text += text;
    else runs.push({ text, bold, italic });
  };
  let { bold, italic } = style;
  for (let index = 0; index < latex.length;) {
    const char = latex[index];
    if (char === "~") { add(" ", bold, italic); index += 1; continue; }
    if (char === "{" ) {
      const inner = group(latex, index);
      if (!inner) break;
      for (const run of nodeRuns(inner[0], numbers, { bold, italic })) add(run.text, run.bold, run.italic);
      index = inner[1];
      continue;
    }
    if (char === "}" ) { index += 1; continue; }
    if (char !== "\\") { add(char, bold, italic); index += 1; continue; }
    const name = /^\\([A-Za-z@]+|.)\s?/.exec(latex.slice(index));
    if (!name) break;
    const command = name[1];
    index += name[0].length;
    const argument = () => {
      const found = group(latex, index);
      if (found) index = found[1];
      return found?.[0] ?? "";
    };
    if (/^[%&$#_{} ]$/.test(command)) add(command === " " ? " " : command, bold, italic);
    else if (command === "rcmpd" || command === "cmpd" || command === "refcmpd") {
      const keys = argument().split(command === "rcmpd" ? /$^/ : ",").map((key) => key.trim());
      add(keys.map((key) => numbers.get(numberedKey(key)) ?? key).join(", "), true, italic);
    } else if (command === "textbf") for (const run of nodeRuns(argument(), numbers, { bold: true, italic })) add(run.text, run.bold, run.italic);
    else if (command === "textit" || command === "emph") for (const run of nodeRuns(argument(), numbers, { bold, italic: true })) add(run.text, run.bold, run.italic);
    else if (command === "bfseries") bold = true;
    else if (command === "itshape") italic = true;
    else if (command === "fontsize") { argument(); argument(); }
    else if (command === "reactiofigurefont" || command === "fontfamily") argument();
    else if (command === "textsubscript" || command === "textsuperscript" || command === "textrm" || command === "textsf" || command === "mbox") {
      for (const run of nodeRuns(argument(), numbers, { bold, italic })) add(run.text, run.bold, run.italic);
    }
    // Any other command (\selectfont, \relax…) prints nothing here.
  }
  return runs;
}

/** The nodes of a figure's `.tex`, or [] for a figure with none. */
export function overlayNodes(tex: string, numbers: ReadonlyMap<string, string>): OverlayNode[] {
  const nodes: OverlayNode[] = [];
  for (const line of tex.split(/\r?\n/)) {
    const match = NODE.exec(line);
    if (!match) continue;
    const size = Number(/\\fontsize\{([\d.]+)\}/.exec(match[3])?.[1] ?? 10);
    nodes.push({ x: Number(match[1]), y: Number(match[2]), size, runs: nodeRuns(match[3], numbers, { bold: /\\bfseries/.test(match[3]), italic: /\\itshape/.test(match[3]) }) });
  }
  return nodes;
}
