import http from "node:http";
import fs from "node:fs";
import path from "node:path";
const here = path.dirname(new URL(import.meta.url).pathname);
export const uploads = [];
export function start(port) {
  const server = http.createServer((req, res) => {
    if (req.method === "POST" && req.url.startsWith("/project/")) {
      const chunks = [];
      req.on("data", (c) => chunks.push(c));
      req.on("end", () => {
        const body = Buffer.concat(chunks).toString("latin1");
        const field = (name) => new RegExp(`name="${name}"\\r\\n\\r\\n([^\\r]*)`).exec(body)?.[1];
        const file = /filename="[^"]*"\r\nContent-Type: [^\r]*\r\n\r\n([\s\S]*?)\r\n--/.exec(body)?.[1];
        uploads.push({ url: req.url, csrf: req.headers["x-csrf-token"], name: field("name"), relativePath: field("relativePath"), content: file });
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify({ success: true, entity_id: "e", entity_type: "file" }));
      });
      return;
    }
    const file = req.url.startsWith("/dist/") ? path.join(here, "../..", req.url) : req.url.startsWith("/harness.js") ? path.join(here, "harness.js") : null;
    if (file) { res.setHeader("content-type", "text/javascript"); res.end(fs.readFileSync(file)); return; }
    res.setHeader("content-type", "text/html");
    res.end(`<!doctype html><html><head><meta name="ol-csrfToken" content="tok123"></head><body><div id="editor"></div><script src="/harness.js"></script><script src="/dist/content.js"></script></body></html>`);
  });
  return new Promise((resolve) => server.listen(port, () => resolve(server)));
}
