/**
 * Where a pasted figure's files go in an Overleaf project. Adapted from
 * reactio-latex (src/import-figure.ts), itself adapted from Lattice
 * (src-tauri/src/project/editable_figure.rs), Apache-2.0, Copyright 2026
 * Leonardo and the Lattice contributors. Changed: names are checked against
 * the project's file tree instead of a disk, nothing is written here, and
 * file bytes are decoded for the browser.
 */
import type { EditableFigureManifest, ImportedFigure } from "./lattice/editable-figure";

/** The most a pasted figure may carry, all its files together. */
const MAX_FIGURE_BYTES = 64 * 1024 * 1024;
/** The most files one paste may carry, its source included. */
const MAX_FIGURE_FILES = 32;
/** Numbered names tried for one file before giving up. */
const MAX_NAME_NUMBER = 10_000;
/** Overleaf refuses longer names. */
const MAX_NAME_LENGTH = 150;

/** The file types figures are drawn in. */
export const DRAWING_EXTENSIONS = ["reactio", "cdxml", "cdx", "drawio", "dio", "ipe", "excalidraw", "ggb", "odg"];
/** What a figure's rendered files may be. */
const OUTPUT_EXTENSIONS = ["tex", "pdf", "pdf_tex", "png", "jpg", "svg", "eps"];

export const NO_FREE_NAME = "No free name was found for the figure.";
const TOO_LARGE = "The figure is too large to import.";

export class FigureError extends Error {}

/** A folder of Overleaf's file tree, as the editor holds it. */
export type TreeFolder = {
  _id: string;
  name: string;
  folders: TreeFolder[];
  docs: { _id: string; name: string }[];
  fileRefs: { _id: string; name: string }[];
};

export const extensionOf = (name: string) => {
  const base = name.split("/").pop() ?? "";
  const dot = base.lastIndexOf(".");
  return dot > 0 ? base.slice(dot + 1).toLowerCase() : "";
};

/** A plain name: one path component of letters, digits, spaces, `.`, `_` and `-`, so it reaches `\input{…}` intact. */
export function fileNameOf(name: string): string {
  if (!name || name === "." || name === ".." || name.length > MAX_NAME_LENGTH || !/^[A-Za-z0-9 ._-]+$/.test(name)) {
    throw new FigureError("The figure names a file without a usable name.");
  }
  return name;
}

/** The bytes of one file, counted against what the whole paste may carry. */
export function bytesOf(data: string, budget: { left: number }): Uint8Array {
  const text = data.replace(/\s+/g, "");
  // Checked before decoding, so an oversized paste is never held twice.
  if (Math.floor(text.length / 4) * 3 > budget.left + 3) throw new FigureError(TOO_LARGE);
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(text)) throw new FigureError("Could not decode the figure.");
  let binary: string;
  try {
    binary = atob(text);
  } catch {
    throw new FigureError("Could not decode the figure.");
  }
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  budget.left -= bytes.length;
  if (budget.left < 0) throw new FigureError(TOO_LARGE);
  return bytes;
}

/** Only file types a figure is made of come in from a paste. */
function checkTypes(names: string[], entry: string) {
  const source = extensionOf(names[0]);
  const sourceAllowed = source === "svg" || DRAWING_EXTENSIONS.includes(source);
  const outputsAllowed = names.slice(1).every((name) => OUTPUT_EXTENSIONS.includes(extensionOf(name)));
  if (!sourceAllowed || !outputsAllowed || extensionOf(entry) !== "tex") {
    throw new FigureError("The figure carries a file type this extension does not import.");
  }
}

const carriesStem = (name: string, stem: string) => name.startsWith(stem) && name[stem.length] === ".";

/** `name` with `stem` swapped for `next` when it starts with `stem.`. */
const renamed = (name: string, stem: string, next: string) => (carriesStem(name, stem) ? next + name.slice(stem.length) : name);

/** `name`, then `name-2`, `name-3`, … (before the extension). */
export function* numbered(name: string): Generator<string> {
  const dot = name.lastIndexOf(".");
  const [base, rest] = dot > 0 ? [name.slice(0, dot), name.slice(dot)] : [name, ""];
  yield name;
  for (let number = 2; number < MAX_NAME_NUMBER; number += 1) yield `${base}-${number}${rest}`;
}

const find = (names: Iterable<string>, test: (name: string) => boolean) => {
  for (const name of names) if (test(name)) return name;
  throw new FigureError(NO_FREE_NAME);
};

/**
 * Where each file goes. Files carrying the entry's stem move together, so the
 * entry's references hold; any other file finds a free name of its own.
 * `taken` says whether a name is used where it would land (LaTeX also looks
 * in the document's folder, so a name taken there counts too).
 */
export function planNames(taken: (name: string) => boolean, names: string[], stem: string): { next: string; renames: [string, string][] } {
  const free = (file: string) => !taken(file);
  const next = find(numbered(stem), (candidate) => names.filter((name) => carriesStem(name, stem)).every((name) => free(renamed(name, stem, candidate))));
  const used = new Set(names.map((name) => renamed(name, stem, next)).filter((name) => carriesStem(name, next)));
  const renames: [string, string][] = names.map((name) => {
    if (carriesStem(name, stem)) return [name, renamed(name, stem, next)];
    const to = find(numbered(name), (candidate) => free(candidate) && !used.has(candidate));
    used.add(to);
    return [name, to];
  });
  return { next, renames };
}

/**
 * `text` with each whole file name of `renames` replaced: a name preceded by
 * a letter, digit, `_` or `-` is part of a longer name and kept.
 */
export function rewriteNames(text: string, renames: [string, string][]): string {
  let out = text;
  for (const [from, to] of renames.filter(([a, b]) => a !== b)) {
    let next = "";
    let rest = out;
    for (let index = rest.indexOf(from); index >= 0; index = rest.indexOf(from)) {
      const joined = index > 0 && /[A-Za-z0-9_-]/.test(rest[index - 1]);
      next += rest.slice(0, index) + (joined ? from : to);
      rest = rest.slice(index + from.length);
    }
    out = next + rest;
  }
  return out;
}

/** The folder at `path` (`a/b`) under `root`, or null when some part of it is missing. */
export function folderAt(root: TreeFolder, path: string): TreeFolder | null {
  let folder: TreeFolder | null = root;
  for (const part of path.split("/").filter(Boolean)) {
    folder = folder.folders.find((child) => child.name === part) ?? null;
    if (!folder) return null;
  }
  return folder;
}

/** The lower-cased names in a folder, files, docs and folders alike. */
const namesIn = (folder: TreeFolder | null) => new Set(folder ? [...folder.folders, ...folder.docs, ...folder.fileRefs].map((entity) => entity.name.toLowerCase()) : []);

/** One file to upload: where it goes from the project root and its bytes. */
export type PlannedFile = { path: string; name: string; bytes: Uint8Array };

export type FigurePlan = { figure: ImportedFigure; files: PlannedFile[] };

/**
 * Checks a pasted figure and names where each of its files goes in
 * `targetDirectory` (from the project root): free names in that folder and in
 * the root, the entry's references to its siblings rewritten to match.
 */
export function planFigure(root: TreeFolder, manifest: EditableFigureManifest, targetDirectory: string): FigurePlan {
  if (manifest.version !== 1) throw new FigureError("This figure was made for a newer version of the editable-figure format.");
  const directory = targetDirectory.replace(/^\/+|\/+$/g, "");
  if (directory.split("/").some((part) => part === ".." || part === "." || (directory && part === "") || (part && !/^[A-Za-z0-9 ._-]+$/.test(part)))) {
    throw new FigureError("The figures folder must be a folder inside the project.");
  }
  const files = [manifest.source, ...manifest.outputs];
  if (files.length > MAX_FIGURE_FILES) throw new FigureError("The figure carries too many files.");
  const budget = { left: MAX_FIGURE_BYTES };
  const named: [string, Uint8Array][] = files.map((file) => [fileNameOf(file.name), bytesOf(file.data, budget)]);
  if (new Set(named.map(([name]) => name.toLowerCase())).size !== named.length) throw new FigureError("The figure names one file twice.");
  let entry: string;
  try {
    entry = fileNameOf(manifest.entry);
  } catch {
    throw new FigureError("The figure names no file to include.");
  }
  if (!named.slice(1).some(([name]) => name === entry)) throw new FigureError("The figure's file to include is not among its files.");
  const names = named.map(([name]) => name);
  checkTypes(names, entry);
  const packages = (manifest.packages ?? []).filter((name) => /^[A-Za-z0-9-]+$/.test(name));

  const target = directory ? folderAt(root, directory) : root;
  // A file (not a folder) somewhere on the way would make the upload fail.
  let walk: TreeFolder | null = root;
  for (const part of directory.split("/").filter(Boolean)) {
    if (!walk) break;
    const lower = part.toLowerCase();
    if ([...walk.docs, ...walk.fileRefs].some((file) => file.name.toLowerCase() === lower)) throw new FigureError("The figures folder leads outside the project.");
    walk = walk.folders.find((child) => child.name === part) ?? null;
  }
  const inTarget = namesIn(target);
  const inRoot = namesIn(root);
  const taken = (name: string) => inTarget.has(name.toLowerCase()) || inRoot.has(name.toLowerCase());
  const stem = entry.replace(/\.[^.]*$/, "") || "figure";
  const { next, renames } = planNames(taken, names, stem);
  const prefix = directory ? `${directory}/` : "";
  const planned: PlannedFile[] = named.map(([name, bytes], index) => {
    const to = renames[index][1];
    const data = name === entry ? new TextEncoder().encode(rewriteNames(decodeText(bytes), renames)) : bytes;
    return { path: `${prefix}${to}`, name: to, bytes: data };
  });
  // The entry goes last: by the time its `\input` resolves, the files it names are there.
  const entryName = renamed(entry, stem, next);
  planned.sort((a, b) => Number(a.name === entryName) - Number(b.name === entryName));
  return {
    figure: { directory, entry: entryName, source: `${prefix}${renames[0][1]}`, packages, preamble: manifest.preamble },
    files: planned,
  };
}

function decodeText(bytes: Uint8Array): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new FigureError("The figure's file to include is not text.");
  }
}

/** The doc, file or folder at `path` (`a/b.tex`) under `root`, or null. */
export function entityAt(root: TreeFolder, path: string): { type: "doc" | "file" | "folder"; id: string } | null {
  const parts = path.split("/").filter(Boolean);
  const name = parts.pop();
  const folder = folderAt(root, parts.join("/"));
  if (!folder || !name) return null;
  const doc = folder.docs.find((item) => item.name === name);
  if (doc) return { type: "doc", id: doc._id };
  const file = folder.fileRefs.find((item) => item.name === name);
  if (file) return { type: "file", id: file._id };
  const child = folder.folders.find((item) => item.name === name);
  return child ? { type: "folder", id: child._id } : null;
}

/** The path of the entity with `id`, or null. */
export function pathOf(root: TreeFolder, id: string, prefix = ""): string | null {
  for (const item of [...root.docs, ...root.fileRefs]) if (item._id === id) return `${prefix}${item.name}`;
  for (const folder of root.folders) {
    const found = pathOf(folder, id, `${prefix}${folder.name}/`);
    if (found) return found;
  }
  return null;
}
