import { describe, expect, it } from "vitest";
import { overlayNodes } from "../src/figure-overlay";

const tex = String.raw`% editable-figure source: Document_2-3.reactio
\begin{tikzpicture}
  \node[inner sep=0pt,anchor=south west] (rdfig) at (0,0) {\includegraphics[width=\rdw,height=\rdh,keepaspectratio]{Document_2-3.pdf}};
  \begin{scope}[x={(rdfig.south east)},y={(rdfig.north west)},every node/.style={inner sep=0pt,anchor=base}]
    \node at (0.5,0.1781) {\reactiofigurefont{phv}\fontsize{10}{12}\selectfont \textbf{\rcmpd{1}}~(xx\%)};
    \node at (0.25,0.9) {\fontsize{8}{9.6}\selectfont\itshape \rcmpd{amine.a.num} and \cmpd{x,y}};
  \end{scope}
\end{tikzpicture}%`;

describe("overlayNodes", () => {
  it("reads each node's place, size and text, compounds as their numbers", () => {
    const nodes = overlayNodes(tex, new Map([["1", "4"], ["amine.a", "2a"], ["x", "7"]]));
    expect(nodes).toEqual([
      { x: 0.5, y: 0.1781, size: 10, runs: [{ text: "4", bold: true, italic: false }, { text: " (xx%)", bold: false, italic: false }] },
      { x: 0.25, y: 0.9, size: 8, runs: [{ text: "2a", bold: true, italic: true }, { text: " and ", bold: false, italic: true }, { text: "7, y", bold: true, italic: true }] },
    ]);
  });

  it("shows the key before a compile has numbered it, and nothing for a figure without marks", () => {
    expect(overlayNodes(tex, new Map())[0].runs[0].text).toBe("1");
    expect(overlayNodes("\\includegraphics{a.pdf}", new Map())).toEqual([]);
  });
});
