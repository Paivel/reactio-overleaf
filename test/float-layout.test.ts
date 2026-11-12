import { describe, expect, it } from "vitest";
import { floatAround } from "../src/float-layout";

const lines = (text: string) => text.split("\n");

describe("floatAround", () => {
  it("finds the float a paste makes", () => {
    const doc = lines("Text\n\\begin{scheme}\n  \\centering\n  \\input{figures/a}\n  \\caption{A}\n  \\label{sch:}\n\\end{scheme}\nMore");
    expect(floatAround(doc, 3)).toEqual({ begin: 1, end: 6 });
  });

  it("takes figure* with options and comments", () => {
    const doc = lines("\\begin{figure*}[tb] % wide\n\\input{figures/a}\n\\end{figure*}");
    expect(floatAround(doc, 1)).toEqual({ begin: 0, end: 2 });
  });

  it("leaves a float with anything else in it, or an include in text", () => {
    expect(floatAround(lines("\\begin{scheme}\n\\input{a}\n\\input{b}\n\\end{scheme}"), 1)).toBeNull();
    expect(floatAround(lines("\\begin{scheme}\nSee\n\\input{a}\n\\end{scheme}"), 2)).toBeNull();
    expect(floatAround(lines("See \\input{a}"), 0)).toBeNull();
    expect(floatAround(lines("\\begin{scheme}\n\\input{a}\n\\end{figure}"), 1)).toBeNull();
  });
});
