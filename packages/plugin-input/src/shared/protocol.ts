/**
 * Synthetic input for a development build: taps, swipes and text sent into the app as if a finger and keyboard
 * did it, the elements on screen to aim them at, and tap recordings to replay. The Input panel and the agent
 * tools call the same operations.
 *
 * Coordinates are React Native points from the top left of the app's window, the units `pageX`/`pageY` use.
 *
 * Pure TypeScript, so the app's bundle can import it.
 */

import type { AttachMethods, SessionState } from '@sleeperhq/rozenite-panel-kit/src/protocol';

export const PLUGIN_ID = '@sleeperhq/rozenite-plugin-input';

export type Point = { x: number; y: number };
export type Frame = { x: number; y: number; width: number; height: number };

/** A view on screen with a test id or an accessibility label. */
export type ScreenElement = {
  testID?: string;
  label?: string;
  value?: string;
  /** e.g. `button`, `selected`, `disabled`, `header`. */
  traits: string[];
  frame: Frame;
  /** The middle of the part of it that is on screen, where a tap on it lands. */
  center: Point;
  /** iOS only: whether a tap at `center` reaches it rather than something drawn over it. */
  hittable?: boolean;
  /** Which window it is in, bottom first; a modal or a sheet is often a window of its own. */
  window: number;
  /** The native view class. */
  type: string;
};

/** How a text view draws its first character. Colors are `#RRGGBBAA`. */
export type TextStyle = { size?: number; weight?: number; italic?: boolean; color?: string; align?: 'center' | 'right' | 'justify' };

/**
 * A view as drawn, in paint order: later views are drawn over earlier ones. Wrappers the same size as their
 * parent with nothing of their own to draw are left out.
 */
export type ViewBox = {
  /** The part of it on screen, inside the scroll views and clipping views around it. */
  frame: Frame;
  /** The whole view, when part of it is clipped off. */
  full?: Frame;
  window: number;
  background?: string;
  border?: { color: string; width: number };
  radius?: number;
  /** A text view's text, or a text field's contents. */
  text?: string;
  /** `text` is a field's placeholder, shown because the field is empty. */
  placeholder?: boolean;
  style?: TextStyle;
};

/** `views` only when asked for. */
export type ElementsSnapshot = { elements: ScreenElement[]; truncated: boolean; screen: Frame; views?: ViewBox[]; viewsTruncated?: boolean };

export type InputSource = 'panel' | 'agent' | 'replay';

/** One input the app was sent, newest last in `InputState.log`. */
export type InputLogEntry = { id: number; at: number; source: InputSource; kind: 'tap' | 'long press' | 'swipe' | 'type' | 'delete'; detail: string; error?: string };

export type RecordingSummary = { fileName: string; name: string; createdAt: string; eventCount: number };

/**
 * The element a recorded tap was aimed at, when it was sent by test id or label rather than by position. Replay
 * finds it again and taps where it is now, so a moved chip or a re-sorted list still gets the same tap.
 */
export type TapTarget = { testID?: string; label?: string };

/**
 * One recorded touch: a tap, or with `to` a swipe ending there after `durationMs`. `t` is ms after the
 * recording's first touch. A tap with a `target` was aimed at that element; its point is where the element was.
 * `screen` is the screen the app was on when the touch was made, from the `currentScreen` option.
 */
export type RecordedTouch = Point & { t: number; to?: Point; durationMs?: number; target?: TapTarget; screen?: string };

export type Recording = {
  name: string;
  createdAt: string;
  screen: { width: number; height: number; scale: number };
  /** The screen the recording began on, so a replay can refuse to start anywhere else. */
  startScreen?: string;
  /** Where the last touch left the app. */
  endScreen?: string;
  events: RecordedTouch[];
};

/** Removes touches by their 1-based number, then keeps only the first `keepFirst`. */
export type RecordingEdit = { remove?: number[]; keepFirst?: number };

/**
 * Replay pacing: by default each touch plays at its recorded time. `gapMs` spaces every touch that far after the
 * one before; `maxGapMs` keeps the recorded gaps but shortens any longer than that.
 */
export type PlayOptions = { force?: boolean; gapMs?: number; maxGapMs?: number; keepGoing?: boolean };

/**
 * The first touch (1-based) about to land on another screen than it was recorded on; `atEnd` when that was after
 * the last touch. `stopped` when the replay stopped there.
 */
export type Divergence = { index: number; atEnd?: boolean; expected: string; actual: string | null; stopped: boolean };

/**
 * `misses` are touches that didn't go quite as recorded: a targeted tap whose element wasn't found, sent to its
 * recorded point instead, or a touch made on another sub-tab of the right screen. `diverged` is the first touch
 * made on another screen altogether.
 */
export type PlaybackState = { fileName: string | null; index: number; total: number; misses: string[]; diverged: Divergence | null };

export type InputState = SessionState & {
  /** False when the native module is missing: an old build, or a release one. */
  available: boolean;
  recording: { active: boolean; count: number };
  playback: PlaybackState;
  recordings: RecordingSummary[];
  log: InputLogEntry[];
};

export type SwipeParams = { from: Point; to: Point; durationMs?: number };

/** The screen with every view as drawn, left out when it hasn't changed since the read `stamp` came with. */
export type ScreenUpdate = { stamp: string; snapshot?: ElementsSnapshot };

export type InputMethods = AttachMethods<InputState> & {
  /**
   * The screen as drawn, or only a new stamp when it hasn't changed since `since`. With `ignoreText`, text changing
   * while no view moved, appeared or went (a clock ticking) doesn't count.
   */
  screen: (params: { since?: string; ignoreText?: boolean }) => Promise<ScreenUpdate>;
  tap: (params: Point) => Promise<void>;
  swipe: (params: SwipeParams) => Promise<void>;
  /** "\n" is the return key. */
  typeText: (params: { text: string }) => Promise<void>;
  /** The delete key, `count` times (1 by default). */
  deleteBackward: (params: { count?: number }) => Promise<void>;
  longPress: (params: Point & { durationMs?: number }) => Promise<void>;
  startRecording: () => Promise<void>;
  /** The saved recording, or null when no taps were recorded. */
  stopRecording: (params: { name?: string }) => Promise<RecordingSummary | null>;
  readRecording: (params: { fileName: string }) => Promise<Recording>;
  editRecording: (params: { fileName: string } & RecordingEdit) => Promise<RecordingSummary>;
  play: (params: { fileName: string } & PlayOptions) => Promise<void>;
  stopPlayback: () => Promise<void>;
  renameRecording: (params: { fileName: string; name: string }) => Promise<void>;
  deleteRecording: (params: { fileName: string }) => Promise<void>;
  /** A recording as JSON text, to share or paste into another device. */
  exportRecording: (params: { fileName: string }) => Promise<{ json: string }>;
  importRecording: (params: { json: string }) => Promise<RecordingSummary>;
};

export type InputEventMap = {
  'input:state': InputState;
};

/** How long a swipe takes when not given; quick enough to scroll past content, slow enough not to fling far. */
export const DEFAULT_SWIPE_MS = 300;

/** How long a long press holds when not given; past the half second most long-press handlers wait for. */
export const DEFAULT_LONG_PRESS_MS = 800;

/** A recorded swipe that ends where it started is a long press. */
export const isHold = (touch: Pick<RecordedTouch, 'x' | 'y' | 'to'>) => !!touch.to && touch.to.x === touch.x && touch.to.y === touch.y;

/** A text field or text view, which takes typing. */
export const isTextField = (element: ScreenElement) =>
  element.traits.includes('editable') || /UITextField|UITextView|RCTUIText|EditText/.test(element.type);
