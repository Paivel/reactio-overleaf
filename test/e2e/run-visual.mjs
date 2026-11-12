// The Visual editor: a pasted figure's \input shows as its PDF.
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
const { chromium } = createRequire(import.meta.url)("playwright");
const here = path.dirname(new URL(import.meta.url).pathname);
const root = path.resolve(here, "../..");
const project = "0123456789abcdef01234567";
const pdf = fs.readFileSync(process.argv[2]);
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 900, height: 600 } });
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
await page.route("https://www.overleaf.com/**", (route) => {
  const url = new URL(route.request().url());
  if (url.pathname === `/project/${project}`) return route.fulfill({ contentType: "text/html", body: `<!doctype html><html><head></head><body><div id="editor"></div><script>${fs.readFileSync(path.join(here, "harness.js"), "utf8")}</script><script>${fs.readFileSync(path.join(root, "dist/content.js"), "utf8")}</script></body></html>` });
  if (url.pathname.endsWith("/file/x1")) return route.fulfill({ contentType: "application/octet-stream", body: "drawing" });
  if (url.pathname.endsWith("/file/x2")) return route.fulfill({ contentType: "application/pdf", headers: { "content-disposition": "attachment; filename=scheme.pdf" }, body: pdf });
  if (url.pathname.endsWith("/doc/d2/download")) return route.fulfill({ contentType: "text/plain", body: [
    "% editable-figure source: scheme.reactio",
    "    \\node at (0.2,0.12) {\\reactiofigurefont{phv}\\fontsize{10}{12}\\selectfont \\textbf{\\rcmpd{ketone}}~(95\\%)};",
    "    \\node at (0.8,0.12) {\\reactiofigurefont{phv}\\fontsize{10}{12}\\selectfont \\textbf{\\rcmpd{alcohol}}};",
  ].join("\n") });
  if (url.pathname.endsWith("/output/output.aux")) return route.fulfill({ contentType: "text/plain", body: "\\chemnum@cmpd {ketone}{1}{1}{}{}{}{}\n\\chemnum@cmpd {alcohol}{2}{2}{}{}{}{}" });
  return route.fulfill({ status: 404, body: "" });
});
await page.goto(`https://www.overleaf.com/project/${project}?compounds&visual`);
await page.waitForFunction(() => window.__reactioOverleaf);
await page.evaluate(() => window.testView.dispatch({ selection: { anchor: 0 } }));
await page.waitForSelector(".reactio-visual-figure canvas", { timeout: 5000 });
await page.waitForTimeout(1500);
console.log("widget:", await page.locator(".reactio-visual-figure").innerText(), "| canvas:", await page.evaluate(() => { const c = document.querySelector(".reactio-visual-figure canvas"); return `${c.width}x${c.height}`; }));
await page.waitForTimeout(800);
console.log("numbers on preview:", await page.evaluate(() => [...document.querySelectorAll(".reactio-visual-figure span[style*='absolute']")].map((n) => n.textContent)));
const shown = () => page.evaluate(() => document.querySelector(".cm-content").innerText);
const check = (text) => ({ code: ["input{figures/scheme}", "begin{scheme}", "end{scheme}", "centering"].filter((part) => text.includes(part)), caption: text.includes("caption{Synthesis}"), label: text.includes("label{sch:one}") });
console.log("shown before click:", check(await shown()));
await page.evaluate(() => { window.opened = []; window.addEventListener("message", (event) => { if (event.data?.body?.kind === "open") window.opened.push(event.data.body.name); }); });
const box = await page.locator(".reactio-visual-figure").boundingBox();
await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
await page.waitForTimeout(600);
console.log("shown after one click:", check(await shown()));
await page.mouse.dblclick(box.x + box.width / 2, box.y + box.height / 2);
await page.waitForTimeout(1500);
console.log("opened on double click:", await page.evaluate(() => window.opened), await page.evaluate(() => document.body.innerText.match(/Reactio:[^\n]*/g)));
await page.screenshot({ path: process.argv[3] });
console.log("pdf.js globals left:", await page.evaluate(() => ["pdfjsWorker", "pdfjsLib"].filter((n) => n in globalThis)));
console.log("errors:", errors);
await browser.close();
