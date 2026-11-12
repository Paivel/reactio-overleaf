/** What the page script, the bridge and the background say to each other. */
export const CHANNEL = "reactio-overleaf";
/** The helper's name, as registered for Chrome native messaging. */
export const HOST_NAME = "com.reactio.overleaf";

/** From the page to the extension. */
export type PageRequest =
  | { kind: "open"; requestId: string; project: string; dir: string; name: string; data: string; outputs: { name: string; data: string }[] }
  | { kind: "ready"; project: string };

/** From the extension to the page. */
export type PageNotice =
  | { kind: "opened"; requestId: string }
  | { kind: "error"; requestId?: string; message: string }
  | { kind: "changed"; project: string; path: string; data: string };

export type Envelope = { channel: typeof CHANNEL; to: "extension"; body: PageRequest } | { channel: typeof CHANNEL; to: "page"; body: PageNotice };
