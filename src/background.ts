/**
 * The background of the extension: it keeps the connection to the helper on
 * this computer (Chrome native messaging), sends it the drawings to open,
 * and passes the files it sends back after each save to an Overleaf tab of
 * their project, which uploads them.
 */
import { HOST_NAME, type PageNotice, type PageRequest } from "./messages";

type HostMessage =
  | { op: "opened"; id: string }
  | { op: "error"; id?: string; message: string }
  | { op: "chunk"; id: string; index: number; total: number; data: string }
  | { op: "changed"; id: string; project: string; path: string }
  | { op: "hello"; id: string; version: string };

const NOT_INSTALLED = "The Reactio helper is not installed on this computer. Run the installer from the extension's helper folder, then reload this page.";

let port: chrome.runtime.Port | null = null;
const waiting = new Map<string, (answer: PageNotice) => void>();
const chunks = new Map<string, string[]>();
/** Files saved while no tab of their project was open; sent when one is. */
const queued: Extract<PageNotice, { kind: "changed" }>[] = [];

function connect(): chrome.runtime.Port {
  if (port) return port;
  const next = chrome.runtime.connectNative(HOST_NAME);
  next.onMessage.addListener(fromHost);
  next.onDisconnect.addListener(() => {
    const reason = chrome.runtime.lastError?.message ?? "The Reactio helper stopped.";
    const message = /not found|forbidden/i.test(reason) ? NOT_INSTALLED : `Reactio helper: ${reason}`;
    port = null;
    for (const [id, answer] of waiting) answer({ kind: "error", requestId: id, message });
    waiting.clear();
  });
  port = next;
  return next;
}

async function deliver(notice: Extract<PageNotice, { kind: "changed" }>) {
  const tabs = await chrome.tabs.query({ url: `https://www.overleaf.com/project/${notice.project}*` });
  for (const tab of tabs) {
    if (tab.id === undefined) continue;
    try {
      // One tab uploads; the others see the change from Overleaf.
      await chrome.tabs.sendMessage(tab.id, notice);
      return;
    } catch {
      // That tab has no bridge (still loading): try the next.
    }
  }
  queued.push(notice);
}

function fromHost(message: HostMessage) {
  switch (message.op) {
    case "opened":
      waiting.get(message.id)?.({ kind: "opened", requestId: message.id });
      waiting.delete(message.id);
      break;
    case "error":
      if (message.id && waiting.has(message.id)) {
        waiting.get(message.id)?.({ kind: "error", requestId: message.id, message: message.message });
        waiting.delete(message.id);
      }
      break;
    case "chunk": {
      const parts = chunks.get(message.id) ?? new Array<string>(message.total);
      parts[message.index] = message.data;
      chunks.set(message.id, parts);
      break;
    }
    case "changed": {
      const parts = chunks.get(message.id) ?? [];
      chunks.delete(message.id);
      void deliver({ kind: "changed", project: message.project, path: message.path, data: parts.join("") });
      break;
    }
  }
}

chrome.runtime.onMessage.addListener((request: PageRequest, sender, answer: (notice: PageNotice) => void) => {
  if (!sender.tab?.url?.startsWith("https://www.overleaf.com/project/")) return false;
  if (request.kind === "ready") {
    for (const notice of queued.splice(0).filter((item) => item.project === request.project)) void deliver(notice);
    return false;
  }
  if (request.kind === "open") {
    try {
      waiting.set(request.requestId, answer);
      connect().postMessage({ op: "open", id: request.requestId, project: request.project, dir: request.dir, name: request.name, data: request.data, outputs: request.outputs });
    } catch (error) {
      waiting.delete(request.requestId);
      answer({ kind: "error", requestId: request.requestId, message: (error as Error).message });
    }
    return true;
  }
  return false;
});
