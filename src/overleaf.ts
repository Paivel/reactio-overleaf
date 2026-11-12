/**
 * What this extension reads from and does in an open Overleaf project. None
 * of it is a supported Overleaf API: the editor view comes from the store
 * Overleaf exposes for browser extensions (`window.overleaf.unstable.store`),
 * the file tree from the editor's React state, and uploads go to the same
 * endpoint the editor's own Upload dialog uses. Each is checked, so a change
 * on Overleaf's side shows a clear error instead of doing something else.
 */
import type { TreeFolder } from "./plan";

/** The parts of a CodeMirror 6 EditorView this extension uses. */
export type EditorViewLike = {
  state: {
    doc: { toString(): string; length: number; lineAt(pos: number): { from: number; to: number; text: string } };
    selection: { main: { from: number; to: number } };
    changes(spec: unknown): { mapPos(pos: number, assoc?: number): number };
  };
  dispatch(spec: unknown): void;
  posAtCoords(coords: { x: number; y: number }): number | null;
  focus(): void;
  contentDOM: HTMLElement;
};

type Store = { get<T>(path: string): T };

declare global {
  interface Window {
    overleaf?: { unstable?: { store?: Store } };
  }
}

/** The project's id, from the page's address. */
export function projectId(location: Location = window.location): string | null {
  return /\/project\/([0-9a-f]{24})(?:[/?#]|$)/.exec(location.pathname + "/")?.[1] ?? null;
}

const meta = (name: string) => document.head.querySelector<HTMLMetaElement>(`meta[name="${name}"]`)?.content ?? "";

/** The editor showing the open file, or null when there is none. */
export function editorView(): EditorViewLike | null {
  try {
    const fromStore = window.overleaf?.unstable?.store?.get<EditorViewLike>("editor.view");
    if (fromStore?.state && typeof fromStore.dispatch === "function") return fromStore;
  } catch {
    // The store may not hold it yet.
  }
  // CodeMirror marks its content element with its view.
  const content = document.querySelector(".cm-content") as (HTMLElement & { cmView?: { view?: EditorViewLike } }) | null;
  return content?.cmView?.view ?? null;
}

/** The id of the file open in the editor, when Overleaf says. */
export function openDocId(): string | null {
  try {
    return window.overleaf?.unstable?.store?.get<string>("editor.open_doc_id") ?? null;
  } catch {
    return null;
  }
}

/** A project file's bytes. */
export async function downloadFile(project: string, fileId: string): Promise<Uint8Array> {
  const response = await fetch(`/Project/${project}/file/${encodeURIComponent(fileId)}`, { credentials: "same-origin" });
  if (!response.ok) throw new UploadError(`Could not read the drawing from Overleaf (${response.status}).`);
  return new Uint8Array(await response.arrayBuffer());
}

/** A project doc's text, as Overleaf has it now. */
export async function downloadDoc(project: string, docId: string): Promise<string> {
  const response = await fetch(`/Project/${project}/doc/${encodeURIComponent(docId)}/download`, { credentials: "same-origin" });
  if (!response.ok) throw new UploadError(`Could not read the figure from Overleaf (${response.status}).`);
  return response.text();
}

/** The name of the file open in the editor, when Overleaf says. */
export function openDocName(): string | null {
  try {
    return window.overleaf?.unstable?.store?.get<string>("editor.open_doc_name") ?? null;
  } catch {
    return null;
  }
}

const isFolder = (value: unknown): value is TreeFolder => {
  const folder = value as TreeFolder | null;
  return Boolean(folder && typeof folder._id === "string" && Array.isArray(folder.folders) && Array.isArray(folder.docs) && Array.isArray(folder.fileRefs));
};

/**
 * A value of the editor's React contexts: the first `name` property of a
 * context value that `accept` takes, found by walking up React's tree from
 * an element inside the editor.
 */
export function reactValue<T>(name: string, accept: (value: unknown) => boolean): T | null {
  const starts = [".cm-editor", "[data-file-id]", ".file-tree", "#ide-root", "#ide-redesign-file-tree"];
  for (const selector of starts) {
    const element = document.querySelector(selector);
    if (!element) continue;
    const key = Object.keys(element).find((field) => field.startsWith("__reactFiber$"));
    let fiber = key ? (element as unknown as Record<string, { return?: unknown; memoizedProps?: { value?: Record<string, unknown> } }>)[key] : undefined;
    for (let depth = 0; fiber && depth < 500; depth += 1) {
      const value = fiber.memoizedProps?.value;
      if (value && typeof value === "object" && name in value && accept(value[name])) return value[name] as T;
      fiber = fiber.return as typeof fiber;
    }
  }
  return null;
}

/** The project's file tree as the editor holds it. */
export function fileTree(): TreeFolder | null {
  return reactValue<TreeFolder>("fileTreeData", isFolder);
}

export class UploadError extends Error {}

const UPLOAD_ERRORS: Record<string, string> = {
  invalid_filename: "Overleaf refused a file name.",
  duplicate_file_name: "A file with that name is already in the project.",
  project_has_too_many_files: "The project has too many files for Overleaf.",
  folder_not_found: "Overleaf could not find the project's folder.",
};

/**
 * Uploads one file to `path` (from the project root), creating its folders.
 * Overleaf replaces a file already at that path, so callers pick free names.
 */
export async function uploadFile(project: string, rootFolderId: string, path: string, bytes: Uint8Array): Promise<void> {
  const name = path.split("/").pop() ?? path;
  const form = new FormData();
  form.append("name", name);
  form.append("type", "");
  if (path.includes("/")) form.append("relativePath", path);
  form.append("qqfile", new Blob([bytes as BlobPart]), name);
  const response = await fetch(`/project/${project}/upload?folder_id=${encodeURIComponent(rootFolderId)}`, {
    method: "POST",
    credentials: "same-origin",
    headers: { "X-CSRF-TOKEN": meta("ol-csrfToken"), Accept: "application/json" },
    body: form,
  });
  let answer: { success?: boolean; error?: string } = {};
  try {
    answer = await response.json();
  } catch {
    // Not JSON: an error page.
  }
  if (!response.ok || !answer.success) {
    const reason = (answer.error && UPLOAD_ERRORS[answer.error]) || `Overleaf answered ${response.status}${answer.error ? ` (${answer.error})` : ""}.`;
    throw new UploadError(`Could not upload ${path}: ${reason}`);
  }
}
