import type { Point } from '../shared/protocol';

/** A finger going down on the app or coming up, with how many fingers were down. */
export type FingerTouch = { phase: 'start' | 'end'; point: Point; touches: number };

/** Where recordings are kept: one JSON text each, by file name. */
export type RecordingStorage = {
  list: () => Promise<string[]>;
  read: (fileName: string) => Promise<string>;
  write: (fileName: string, contents: string) => Promise<void>;
  remove: (fileName: string) => Promise<void>;
};

export type InputOptions = {
  /**
   * The screen the app is on, named any way that stays the same between visits, with an optional sub-screen after a
   * `#` (a tab inside it, say). Recordings note it with each touch and a replay checks it: one that drifts onto
   * another screen stops, while another sub-screen only counts as a miss. Without it nothing is checked.
   */
  currentScreen?: () => string | null;
  /**
   * Finger touches anywhere in the app, so a recording keeps the ones made by hand; `InputTouchCapture` at the app's
   * root is one source. Without it only the inputs the tools send are recorded.
   */
  subscribeToTouches?: (listener: (touch: FingerTouch) => void) => () => void;
  /** Where recordings are kept; `fileRecordingStorage` keeps them on disk. Without it they last until the JS reloads. */
  storage?: RecordingStorage;
};

let options: InputOptions = {};

export const inputOptions = (): InputOptions => options;

export function setInputOptions(next: InputOptions): void {
  options = next;
}

export const currentScreen = (): string | null => options.currentScreen?.() ?? null;
