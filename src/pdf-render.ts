/**
 * Draws the first page of a PDF on a canvas with PDF.js, bundled here: the
 * one Overleaf loads is not reachable from outside its code. It runs on the
 * page's thread ("fake worker"), so the page's rules on workers do not matter.
 *
 * PDF.js sets globals when it loads (`pdfjsLib`, and `pdfjsWorker`, which
 * would move Overleaf's own PDF.js off its worker), so it is loaded only when
 * a figure is first drawn, its globals put back as they were at once, and
 * `pdfjsWorker` set only while a document is being opened.
 */
type PdfJs = typeof import("pdfjs-dist");

let loaded: Promise<{ pdfjs: PdfJs; worker: unknown }> | null = null;

function load() {
  loaded ??= (async () => {
    const scope = globalThis as Record<string, unknown>;
    const saved = { pdfjsLib: scope.pdfjsLib, pdfjsWorker: scope.pdfjsWorker };
    const has = { pdfjsLib: "pdfjsLib" in scope, pdfjsWorker: "pdfjsWorker" in scope };
    try {
      const pdfjs = await import("pdfjs-dist");
      const worker = await import("pdfjs-dist/build/pdf.worker.mjs");
      return { pdfjs, worker };
    } finally {
      for (const name of ["pdfjsLib", "pdfjsWorker"] as const) {
        if (has[name]) scope[name] = saved[name];
        else delete scope[name];
      }
    }
  })();
  return loaded;
}

/** Renders page 1 of `bytes` at `cssWidth` pixels wide (at most twice its natural size); returns its CSS size and CSS pixels per PDF point. */
export async function renderFirstPage(bytes: Uint8Array, canvas: HTMLCanvasElement, cssWidth: number): Promise<{ width: number; height: number; scale: number }> {
  const { pdfjs, worker } = await load();
  const scope = globalThis as Record<string, unknown>;
  const had = "pdfjsWorker" in scope;
  const before = scope.pdfjsWorker;
  scope.pdfjsWorker = worker;
  let task;
  try {
    task = pdfjs.getDocument({ data: bytes.slice(), isEvalSupported: false });
  } finally {
    if (had) scope.pdfjsWorker = before;
    else delete scope.pdfjsWorker;
  }
  const pdf = await task.promise;
  try {
    const page = await pdf.getPage(1);
    const natural = page.getViewport({ scale: 1 });
    const scale = Math.min(cssWidth / natural.width, 2);
    const ratio = window.devicePixelRatio || 1;
    const viewport = page.getViewport({ scale: scale * ratio });
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
    canvas.style.width = `${Math.round(viewport.width / ratio)}px`;
    canvas.style.height = `${Math.round(viewport.height / ratio)}px`;
    await page.render({ canvasContext: canvas.getContext("2d")!, viewport }).promise;
    return { width: viewport.width / ratio, height: viewport.height / ratio, scale };
  } finally {
    void pdf.destroy();
  }
}
