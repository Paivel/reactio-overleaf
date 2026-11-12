/**
 * Which float a pasted figure goes in. ACS journals number reaction schemes
 * apart from figures ("Scheme 1"), and their class, achemso, defines a
 * `scheme` float, as do the float and newfloat packages when a document asks.
 * A drawing pasted into such a document goes in a `scheme`, labelled `sch:`.
 */
export type FloatKind = { environment: "figure" | "scheme"; labelPrefix: string };

const FIGURE: FloatKind = { environment: "figure", labelPrefix: "fig:" };
const SCHEME: FloatKind = { environment: "scheme", labelPrefix: "sch:" };

/** Ways a preamble gets a `scheme` float: the ACS class, packages that bring one, or a definition. */
const HAS_SCHEME = [
  /\\documentclass\s*(?:\[[^\]]*\])?\s*\{\s*achemso\s*\}/,
  /\\usepackage\s*(?:\[[^\]]*\])?\s*\{[^}]*\b(?:chemstyle|chemscheme)\b[^}]*\}/,
  /\\(?:newfloat|DeclareFloatingEnvironment|newenvironment|NewDocumentEnvironment)\s*(?:\[[^\]]*\])?\s*\{\s*scheme\s*\}/,
];

const code = (text: string) => text.replace(/(?<!\\)%.*$/gm, "");

/** The float for `setting` ("auto", "figure" or "scheme"): auto is `scheme` when the root document has one, else `figure`. */
export function floatKind(rootText: string, setting: string): FloatKind {
  if (setting === "scheme") return SCHEME;
  if (setting === "figure") return FIGURE;
  const preamble = code(rootText).split(/\\begin\s*\{document\}/)[0];
  return HAS_SCHEME.some((pattern) => pattern.test(preamble)) ? SCHEME : FIGURE;
}
