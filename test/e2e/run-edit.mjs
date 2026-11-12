// The real extension in Chromium, the real helper over native messaging, and a stand-in for Overleaf.
import { createRequire } from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
const { chromium } = createRequire(import.meta.url)("playwright");
const here = path.dirname(new URL(import.meta.url).pathname);
const root = path.resolve(here, "../..");
const profile = fs.mkdtempSync(path.join(os.tmpdir(), "reactio-profile-"));
const work = fs.mkdtempSync(path.join(os.tmpdir(), "reactio-work-"));
const id = fs.readFileSync(path.join(root, "host/extension-id.txt"), "utf8").trim();
fs.mkdirSync(path.join(profile, "NativeMessagingHosts"));
fs.writeFileSync(path.join(profile, "NativeMessagingHosts/com.reactio.overleaf.json"), JSON.stringify({
  name: "com.reactio.overleaf", description: "test", path: path.join(root, "dist/host/linux"), type: "stdio", allowed_origins: [`chrome-extension://${id}/`] }));
const context = await chromium.launchPersistentContext(profile, {
  channel: "chromium", headless: true,
  args: [`--disable-extensions-except=${root}`, `--load-extension=${root}`],
  env: { ...process.env, REACTIO_OVERLEAF_DIR: work, REACTIO_OVERLEAF_OPEN: path.join(here, "fake-reactio.sh") },
});
const uploads = [];
const project = "0123456789abcdef01234567";
await context.route("https://www.overleaf.com/**", async (route) => {
  const url = new URL(route.request().url());
  if (url.pathname === `/project/${project}`) return route.fulfill({ contentType: "text/html", body: `<!doctype html><html><head><meta name="ol-csrfToken" content="tok"></head><body><div id="editor"></div><script>${fs.readFileSync(path.join(here, "harness.js"), "utf8")}</script></body></html>` });
  if (url.pathname.endsWith("/doc/d2/download")) return route.fulfill({ contentType: "text/plain", body: "% editable-figure source: scheme.reactio\n\\node{x};\n" });
  if (url.pathname.endsWith("/file/x2")) return route.fulfill({ contentType: "application/pdf", body: "%PDF old" });
  if (url.pathname.endsWith("/file/x1")) return route.fulfill({ contentType: "application/octet-stream", body: '{"drawing":"old"}' });
  if (url.pathname.endsWith("/upload")) {
    const body = route.request().postDataBuffer().toString("latin1");
    uploads.push({ relativePath: /name="relativePath"\r\n\r\n([^\r]*)/.exec(body)?.[1], content: /filename="[^"]*"\r\nContent-Type: [^\r]*\r\n\r\n([\s\S]*?)\r\n--/.exec(body)?.[1] });
    return route.fulfill({ contentType: "application/json", body: '{"success":true}' });
  }
  if (url.pathname.endsWith("/sync/pdf")) return route.fulfill({ contentType: "application/json", body: JSON.stringify({ code: [{ file: "figures/scheme.tex", line: 2 }] }) });
  return route.fulfill({ status: 404, body: "" });
});
const page = await context.newPage();
const logs = [];
page.on("console", (m) => logs.push(m.text()));
await page.goto(`https://www.overleaf.com/project/${project}?edit`);
await page.waitForFunction(() => window.__reactioOverleaf);
await page.waitForTimeout(500);
// Double click on the figure in the PDF preview (process.argv[2] === "editor": on the line that includes it).
if (process.argv[2] === "editor") await page.locator(".cm-line", { hasText: "input{figures/scheme}" }).dblclick();
else {
  // A plain double click is Overleaf's (to the source); with Cmd it opens the drawing, and Overleaf's answer stays where the caret is.
  await page.locator(".pdfViewer .textLayer").dblclick({ position: { x: 150, y: 60 } });
  console.log("plain double click went to Overleaf:", await page.evaluate(() => window.overleafSynced === 1), "| toasts:", JSON.stringify(await page.locator("#reactio-overleaf-toasts").innerText().catch(() => "")));
  await page.locator(".pdfViewer .textLayer").dblclick({ position: { x: 150, y: 60 }, modifiers: ["Meta"] });
}
await page.waitForFunction(() => [...document.querySelectorAll("#reactio-overleaf-toasts [data-kind]")].some((n) => /open in Reactio|helper|error/i.test(n.textContent) && n.dataset.kind !== "progress"), null, { timeout: 15000 });
if (process.argv[2] === "open-tex") {
  // As after Overleaf's own jump to the figure's .tex: that file is the one open.
  await page.evaluate(() => {
    window.testStore.set("editor.open_doc_id", "d2");
    const view = window.testView;
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: "% editable-figure source: scheme.reactio\n\\node{x};\n" } });
  });
}
if (!process.argv[2]) console.log("Overleaf's answer after Cmd double click:", JSON.stringify(await page.evaluate(() => window.overleafAnswer)));
console.log("toasts after open:", await page.locator("#reactio-overleaf-toasts").innerText());
console.log("opened.log:", fs.existsSync(path.join(work, "opened.log")) ? fs.readFileSync(path.join(work, "opened.log"), "utf8") : "(none)");
console.log("beside the drawing:", fs.readdirSync(path.join(work, project, "figures")));
console.log("drawing on disk:", fs.readFileSync(path.join(work, project, "figures/scheme.reactio"), "utf8"));
// The stand-in "saves" 2 s later; the helper waits for the files to settle, then sends them.
await page.waitForFunction(() => /updated from Reactio/.test(document.querySelector("#reactio-overleaf-toasts")?.textContent ?? ""), null, { timeout: 15000 }).catch(() => {});
if (process.argv[2] === "open-tex") console.log("editor now:", JSON.stringify(await page.evaluate(() => window.testView.state.doc.toString())));
console.log("uploads:", JSON.stringify(uploads, null, 1));
console.log("toasts:", await page.locator("#reactio-overleaf-toasts").innerText());
console.log("logs:", logs.filter((l) => l.includes("Reactio")));
await context.close();
