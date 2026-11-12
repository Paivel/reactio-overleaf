// Compound marks on a stand-in for Overleaf: completion after \rcmpd{, hover, and the Compounds panel.
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
const { chromium } = createRequire(import.meta.url)("playwright");
const here = path.dirname(new URL(import.meta.url).pathname);
const root = path.resolve(here, "../..");
const project = "0123456789abcdef01234567";
const browser = await chromium.launch();
const page = await browser.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
await page.route("https://www.overleaf.com/**", (route) => {
  const url = new URL(route.request().url());
  if (url.pathname === `/project/${project}`) return route.fulfill({ contentType: "text/html", body: `<!doctype html><html><head><meta name="ol-csrfToken" content="tok"></head><body><div id="editor"></div><script>${fs.readFileSync(path.join(here, "harness.js"), "utf8")}</script><script>${fs.readFileSync(path.join(root, "dist/content.js"), "utf8")}</script></body></html>` });
  if (url.pathname.endsWith("/doc/d2/download")) return route.fulfill({ contentType: "text/plain", body: "% editable-figure source: scheme.reactio\n\\node{\\rcmpd{ketone}};\\node{\\rcmpd{amine.a.num}};\n" });
  if (url.pathname.endsWith("/output/output.aux")) return route.fulfill({ contentType: "text/plain", body: [
    "\\newlabel{sch:one}{{1}{1}}",
    "\\chemnum@cmpd {ketone}{1}{1}{}{}{}{}",
    "\\chemnum@cmpd {amine}{2}{2}{}{}{}{}",
    "\\chemnum@subcmpd {amine}{a}{1}{a}",
  ].join("\n") });
  if (url.pathname.endsWith("/sync/pdf")) {
    // The figure's numbers come from figures/scheme.tex line 2; the page number at the bottom from main.tex.
    const v = Number(url.searchParams.get("v"));
    return route.fulfill({ contentType: "application/json", body: JSON.stringify({ code: [v > 200 ? { file: "main.tex", line: 9 } : { file: "figures/scheme.tex", line: 2 }] }) });
  }
  if (url.pathname.endsWith("/doc/d/download")) return route.fulfill({ contentType: "text/plain", body: "" });
  return route.fulfill({ status: 404, body: "" });
});
await page.goto(`https://www.overleaf.com/project/${project}?compounds`);
await page.waitForFunction(() => window.__reactioOverleaf);
// Type \rcmpd{ after "The ketone ".
await page.evaluate(() => {
  const view = window.testView;
  const at = view.state.doc.toString().indexOf("The ketone ") + "The ketone ".length;
  view.dispatch({ selection: { anchor: at } });
  view.focus();
});
await page.keyboard.type("\\rcmpd{");
await page.waitForSelector(".cm-tooltip-autocomplete li", { timeout: 5000 });
console.log("completion:", (await page.locator(".cm-tooltip-autocomplete").innerText()).replace(/\n/g, " | "));
await page.keyboard.type("ket");
await page.waitForTimeout(300);
await page.keyboard.press("Enter");
await page.keyboard.type("}");
const line = await page.evaluate(() => window.testView.state.doc.toString().split("\n").find((l) => l.startsWith("The ketone")));
console.log("line:", line);
// Hover the mark just written.
const spot = await page.evaluate(() => {
  const view = window.testView;
  const at = view.state.doc.toString().indexOf("{ketone}") + 3;
  const coords = view.coordsAtPos(at);
  return { x: coords.left + 2, y: (coords.top + coords.bottom) / 2 };
});
await page.keyboard.press("Escape");
await page.mouse.move(spot.x - 40, spot.y + 40);
await page.mouse.move(spot.x, spot.y, { steps: 5 });
await page.waitForSelector(".cm-tooltip-hover", { timeout: 5000 }).catch(() => {});
await page.waitForTimeout(500);
console.log("hover:", await page.locator(".cm-tooltip-hover").innerText().catch(() => "(none)"));
// The panel: find by the number seen in the PDF.
await page.click("#reactio-overleaf-compounds-button");
await page.fill("#reactio-overleaf-compounds input", "2a");
await page.waitForTimeout(600);
console.log("panel:", (await page.locator("#reactio-overleaf-compounds").innerText()).replace(/\n/g, " | "));
await page.keyboard.press("Escape");
await page.waitForTimeout(3500);
const marked = await page.evaluate(() => [...document.querySelectorAll(".textLayer span")].map((s) => `${s.textContent}:${s.dataset.reactioCompound ?? "-"}:${s.title}`));
console.log("pdf numbers:", marked);
await page.screenshot({ path: process.argv[2] ?? path.join(here, "compounds.png") });
console.log("errors:", errors);
await browser.close();
