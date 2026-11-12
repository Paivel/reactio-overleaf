/** Small notices in the page's corner: what a paste did, or why it could not. */
type Kind = "progress" | "success" | "info" | "error";

const COLORS: Record<Kind, string> = { progress: "#1f6feb", success: "#138a36", info: "#6e5a00", error: "#b42318" };
const STAY_MS: Record<Kind, number> = { progress: 0, success: 4000, info: 0, error: 0 };

function stack(): HTMLElement {
  let box = document.getElementById("reactio-overleaf-toasts");
  if (!box) {
    box = document.createElement("div");
    box.id = "reactio-overleaf-toasts";
    box.style.cssText = "position:fixed;right:16px;bottom:56px;z-index:2147483647;display:flex;flex-direction:column;gap:8px;max-width:min(440px,calc(100vw - 32px));font:13px/1.4 system-ui,sans-serif";
    document.body.append(box);
  }
  return box;
}

/** Shows `message`; returns a function that removes it. `copy` adds a button that copies that text. */
export function toast(message: string, kind: Kind, copy?: string): () => void {
  const note = document.createElement("div");
  note.setAttribute("role", kind === "error" ? "alert" : "status");
  note.dataset.kind = kind;
  note.style.cssText = `background:#fff;color:#1f2328;border-left:4px solid ${COLORS[kind]};border-radius:6px;box-shadow:0 4px 16px rgba(0,0,0,.18);padding:10px 12px;white-space:pre-wrap;word-break:break-word`;
  const text = document.createElement("div");
  text.textContent = message;
  note.append(text);
  const remove = () => note.remove();
  const buttons = document.createElement("div");
  buttons.style.cssText = "display:flex;gap:8px;justify-content:flex-end;margin-top:6px";
  if (copy) {
    const button = document.createElement("button");
    button.textContent = "Copy lines";
    button.onclick = () => void navigator.clipboard.writeText(copy).then(() => { button.textContent = "Copied"; });
    buttons.append(button);
  }
  if (kind !== "progress") {
    const close = document.createElement("button");
    close.textContent = "Close";
    close.onclick = remove;
    buttons.append(close);
  }
  for (const button of buttons.querySelectorAll("button")) button.style.cssText = "border:1px solid #d0d7de;background:#f6f8fa;border-radius:4px;padding:2px 8px;cursor:pointer;font:inherit";
  if (buttons.childElementCount) note.append(buttons);
  stack().append(note);
  if (STAY_MS[kind]) setTimeout(remove, STAY_MS[kind]);
  return remove;
}
