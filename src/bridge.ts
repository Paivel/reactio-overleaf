/**
 * The extension's side of the page (an isolated content script): the page
 * script cannot reach the extension, so its requests come here through
 * `postMessage` and go on to the background, and the answers come back.
 */
import { CHANNEL, type Envelope, type PageNotice, type PageRequest } from "./messages";

const toPage = (body: PageNotice) => window.postMessage({ channel: CHANNEL, to: "page", body } satisfies Envelope, location.origin);

window.addEventListener("message", (event: MessageEvent) => {
  const data = event.data as Envelope | undefined;
  if (event.source !== window || data?.channel !== CHANNEL || data.to !== "extension") return;
  const body = data.body as PageRequest;
  const fail = (error: unknown) => {
    const message = String((error as Error)?.message ?? error);
    // After the extension is reloaded or updated, a page opened before it can no longer reach it.
    const stale = /context invalidated|Receiving end does not exist/i.test(message) || !chrome.runtime?.id;
    toPage({ kind: "error", requestId: body.kind === "open" ? body.requestId : undefined, message: stale ? "The extension was updated. Reload this page (Cmd+R), then try again." : message });
  };
  try {
    chrome.runtime.sendMessage(body).then((answer: PageNotice | undefined) => answer && toPage(answer), fail);
  } catch (error) {
    fail(error);
  }
});

chrome.runtime.onMessage.addListener((message: PageNotice) => {
  if (message?.kind === "changed") toPage(message);
});

// Files saved in Reactio Draw while no tab of this project was open come now.
const project = /\/project\/([0-9a-f]{24})/.exec(location.pathname)?.[1];
if (project) {
  try {
    void chrome.runtime.sendMessage({ kind: "ready", project } satisfies PageRequest).catch(() => undefined);
  } catch {
    // The extension was reloaded under this page.
  }
}
