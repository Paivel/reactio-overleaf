import { describe, expect, it } from "vitest";
import { compoundRows, rowsForNumber } from "../src/compound-list";

const sources = [
  String.raw`Plain \rcmpd{plain}, \rcmpd{amine.a.num} and \cmpd{alc}.`,
  String.raw`\node {\textbf{\rcmpd{1}}~(xx\%)};`,
];
const numbers = new Map([["plain", "1"], ["amine.a", "2.1"], ["alc", "3"], ["1", "4"]]);

describe("the compounds to look a number up in", () => {
  it("gives each its number and the exact LaTeX that cites it", () => {
    const rows = compoundRows(sources, numbers, new Map([["1", "Scheme 1"]]));
    expect(rows.map((row) => [row.number, row.command])).toEqual([
      ["1", String.raw`\rcmpd{plain}`],
      ["2.1", String.raw`\rcmpd{amine.a.num}`],
      ["3", String.raw`\cmpd{alc}`],
      ["4", String.raw`\rcmpd{1}`],
    ]);
    expect(rows[3].place).toBe("Scheme 1");
  });
  it("finds a number exactly first, then the numbers it starts", () => {
    const rows = compoundRows(sources, new Map([["plain", "1"], ["amine.a", "12"], ["alc", "21"]]), new Map());
    expect(rowsForNumber(rows, "1").map((row) => row.number)).toEqual(["1", "12"]);
    expect(rowsForNumber(rows, "").length).toBe(rows.length);
  });
});
