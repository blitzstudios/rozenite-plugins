/**
 * The attachment every panel built on the kit holds on the app, shared by the panels and the app's bridges. Pure
 * TypeScript, so the app's bundle can import it.
 *
 * A panel calls `attach` on mount and every {@linkcode ATTACH_HEARTBEAT_MS}; the app treats it as gone
 * after {@linkcode ATTACH_LEASE_MS} without one, and pushes its state as `<plugin>:state` in between.
 */

export const ATTACH_HEARTBEAT_MS = 5_000;
/** Long, because a capture stalls the app's JS thread for seconds. */
export const ATTACH_LEASE_MS = 30_000;

/** What every panel's state carries. */
export type SessionState = {
  /** New each time the app's JS starts, so a panel can tell a reload from a reconnect. */
  sessionId: string;
};

/** A file on the device a panel can save: its path there, and the name to suggest. */
export type CaptureFile = { path: string; filename: string };

/** The most bytes of a file one read answers. */
export const FILE_CHUNK_BYTES = 1024 * 1024;

/** Bytes of a file, as base64, and the file's whole size. */
export type FileChunk = { base64: string; size: number };

export type AttachMethods<S extends SessionState> = {
  attach: (params: { panelId: string }) => Promise<S>;
  detach: (params: { panelId: string }) => Promise<void>;
};
