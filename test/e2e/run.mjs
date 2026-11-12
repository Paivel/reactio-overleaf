import { createRequire } from "node:module";
const { chromium } = createRequire(import.meta.url)("playwright");
import { start, uploads } from "./server.mjs";
const server = await start(8765);
const browser = await chromium.launch();
const page = await browser.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("dialog", (d) => d.accept());
await page.goto("http://localhost:8765/project/0123456789abcdef01234567?paste");
const b64 = (s) => Buffer.from(s).toString("base64");
const manifest = { version: 1, name: "scheme", source: { name: "scheme.reactio", data: b64('{"drawing":1}') },
  outputs: [{ name: "scheme.pdf", data: b64("%PDF-1.5 fake") }, { name: "scheme.tex", data: b64("% editable-figure source: scheme.reactio\n\\begin{tikzpicture}\\node{\\includegraphics{scheme.pdf}};\\node{\\rcmpd{a}};\\end{tikzpicture}\n") }],
  entry: "scheme.tex", packages: ["tikz", "chemnum"], preamble: ["\\providecommand\\rcmpd[1]{\\cmpd{#1}}"] };
const html = `<meta charset="utf-8"><div data-editable-figure="${JSON.stringify(manifest).replaceAll("&", "&amp;").replaceAll('"', "&quot;")}">\\input{figures/scheme}</div>`;
// Caret on the empty line of the body, then a paste as the browser sends it.
await page.evaluate((html) => {
  const view = window.testView;
  const at = view.state.doc.toString().indexOf("\n\n") + 1;
  view.dispatch({ selection: { anchor: at } });
  const data = new DataTransfer();
  data.setData("text/html", html);
  data.setData("text/plain", "\\input{figures/scheme}");
  view.contentDOM.dispatchEvent(new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }));
}, html);
await page.waitForFunction(() => document.querySelector('#reactio-overleaf-toasts [data-kind="success"], #reactio-overleaf-toasts [data-kind="error"], #reactio-overleaf-toasts [data-kind="info"]'));
const result = await page.evaluate(() => ({ doc: window.testView.state.doc.toString(), caret: window.testView.state.selection.main.head, toast: document.querySelector("#reactio-overleaf-toasts").innerText }));
console.log(result.doc);
console.log("caret at:", JSON.stringify(result.doc.slice(result.caret - 10, result.caret + 5)));
console.log("toast:", result.toast);
console.log(JSON.stringify(uploads, null, 1));
await page.screenshot({ path: process.argv[2] });
console.log("errors:", errors);
await browser.close(); server.close();
