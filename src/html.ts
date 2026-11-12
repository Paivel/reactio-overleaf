/** Reading one attribute out of a clipboard HTML fragment, without a DOM. */

const NAMED: Record<string, string> = { quot: '"', amp: "&", lt: "<", gt: ">", apos: "'", nbsp: " " };

/** `&quot;`, `&#34;`, `&#x22;` and the like, as the characters they stand for. */
export function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-fA-F]+|#[0-9]+|[A-Za-z]+);/g, (whole, body: string) => {
    if (body[0] === "#") {
      const code = body[1] === "x" || body[1] === "X" ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      return Number.isFinite(code) && code >= 0 && code <= 0x10ffff ? String.fromCodePoint(code) : whole;
    }
    return NAMED[body] ?? whole;
  });
}

/** Whether an attribute name starts at `at`: walking the tag it is in, quoted values skipped, reaches it between attributes. */
function startsAttribute(html: string, at: number): boolean {
  if (!/\s/.test(html[at - 1] ?? "")) return false;
  const open = html.lastIndexOf("<", at);
  if (open < 0 || !/[A-Za-z]/.test(html[open + 1] ?? "")) return false;
  for (let index = open + 1; index < at; index += 1) {
    const char = html[index];
    if (char === ">") return false;
    if (char === '"' || char === "'") {
      const end = html.indexOf(char, index + 1);
      if (end < 0 || end >= at) return false;
      index = end;
    }
  }
  return true;
}

/**
 * The value of the first `name` attribute in `html`, as a browser would read
 * it: double-quoted, single-quoted or bare, entities decoded. Null when absent.
 * Only a tag's attribute counts, not the same text in the page's words. A
 * linear scan: the value can be megabytes of base64.
 */
export function htmlAttribute(html: string, name: string): string | null {
  const lower = html.toLowerCase();
  const wanted = name.toLowerCase();
  for (let at = lower.indexOf(wanted); at >= 0; at = lower.indexOf(wanted, at + 1)) {
    if (!startsAttribute(html, at)) continue;
    let index = at + wanted.length;
    while (/\s/.test(html[index] ?? "")) index += 1;
    if (html[index] !== "=") continue;
    index += 1;
    while (/\s/.test(html[index] ?? "")) index += 1;
    const quote = html[index];
    if (quote === '"' || quote === "'") {
      const end = html.indexOf(quote, index + 1);
      if (end < 0) return null;
      return decodeEntities(html.slice(index + 1, end));
    }
    const bare = /^[^\s"'=<>`]+/.exec(html.slice(index, index + 1_000_000));
    return bare ? decodeEntities(bare[0]) : "";
  }
  return null;
}
