import { createRozeniteRpc } from '@rozenite/plugin-bridge';
import type { RozeniteDevToolsClient } from '@rozenite/plugin-bridge';
import {
  DEFAULT_LONG_PRESS_MS,
  DEFAULT_SWIPE_MS,
  isHold,
  type ElementsSnapshot,
  type InputEventMap,
  type InputLogEntry,
  type InputMethods,
  type InputSource,
  type InputState,
  type PlayOptions,
  type Point,
  type Recording,
  type RecordingEdit,
  type RecordingSummary,
  type ScreenElement,
  type SwipeParams,
  type TapTarget,
} from '../shared/protocol';
import { isInputAvailable, nativeInput } from './native';
import { quietLogBox } from './quiet_logbox';
import { reactCommitCount } from './react_commits';
import { tapPlayer } from './tap_player';
import { tapRecorder } from './tap_recorder';
import * as recordingStore from './tap_recordings_store';
import { showTouch } from './touch_indicator';
import { aimPoint, at, describeTarget, labelMatches, preferTappable } from './snapshot';
import { createPanelLeases } from '@sleeperhq/rozenite-panel-kit/react-native';

/** How many inputs the log keeps. */
const INPUT_LOG_LIMIT = 50;
/** How long state changes gather before they go to the panels together. */
const FLUSH_MS = 100;
/** How long a replayed tap looks for its element, which may still be animating in, before using the recorded point. */
const TARGET_WAIT_MS = 3000;
const TARGET_POLL_MS = 150;

const sleep = (ms: number) =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });

/** The element a replayed tap was aimed at: the reachable match tap-element would prefer, then the nearest. */
function pickTarget(elements: ScreenElement[], target: TapTarget, near: Point): ScreenElement | null {
  const { testID, label } = target;
  const matches = elements.filter(
    (element) => element.hittable !== false && (testID ? element.testID === testID : !!label && labelMatches(element.label, label)),
  );
  const distance = (element: ScreenElement) => Math.hypot(element.center.x - near.x, element.center.y - near.y);
  return matches.sort((a, b) => preferTappable(a, b) || distance(a) - distance(b))[0] ?? null;
}

const randomId = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

/** Changes whenever the screen does, or null when React's commits can't be counted. */
async function screenStamp(): Promise<string | null> {
  const commits = reactCommitCount();
  return commits === null ? null : `${await nativeInput.fingerprint()}.${commits}`;
}

const viewsPart = (stamp: string) => stamp.split('.')[0];

const round = (point: Point): Point => ({ x: Math.round(point.x), y: Math.round(point.y) });

/** `record: false` leaves an input out of the recording being made, for the taps that set it up. */
type SendOptions = { record?: boolean };

/** What the Input panel's calls and the agent tools do, shared so the two can't drift. */
export type InputOperations = {
  state: () => InputState;
  /** With `views`, every view as drawn too, for the wireframe. */
  elements: (options?: { views?: boolean }) => Promise<ElementsSnapshot>;
  /** With `target`, a recording keeps the element the tap was aimed at, so replay can find it again. */
  tap: (point: Point, source: InputSource, target?: TapTarget, options?: SendOptions) => Promise<void>;
  /** Recorded as a swipe that ends where it started, aimed at `target` like a tap. */
  longPress: (point: Point, durationMs: number, source: InputSource, target?: TapTarget, options?: SendOptions) => Promise<void>;
  swipe: (params: SwipeParams, source: InputSource, options?: SendOptions) => Promise<void>;
  typeText: (text: string, source: InputSource) => Promise<void>;
  /** The delete key, `count` times. */
  deleteBackward: (count: number, source: InputSource) => Promise<void>;
  startRecording: () => void;
  stopRecording: (name?: string) => Promise<RecordingSummary | null>;
  play: (fileName: string, options?: PlayOptions) => Promise<{ finished: Promise<void> }>;
  stopPlayback: () => void;
  recordings: () => Promise<RecordingSummary[]>;
  readRecording: (fileName: string) => Promise<Recording>;
  editRecording: (fileName: string, edit: RecordingEdit) => Promise<RecordingSummary>;
};

export type InputBridge = { operations: InputOperations; stop: () => void };

/** Answers the Input panel and, while one is attached, pushes the log, the recorder and playback as they change. */
export function startInputBridge(client: RozeniteDevToolsClient<InputEventMap>): InputBridge {
  const rpc = createRozeniteRpc<InputMethods>(client);
  const sessionId = randomId();
  const log: InputLogEntry[] = [];
  let logId = 0;
  let saved: RecordingSummary[] = [];
  let timer: ReturnType<typeof setTimeout> | null = null;

  const state = (): InputState => ({
    sessionId,
    available: isInputAvailable(),
    recording: { active: tapRecorder.isRecording(), count: tapRecorder.count() },
    playback: tapPlayer.getState(),
    recordings: saved,
    log: [...log],
  });

  const leases = createPanelLeases((attached) => {
    if (!attached && timer) {
      clearTimeout(timer);
      timer = null;
    }
  });

  const changed = () => {
    if (!leases.attached()) return;
    timer ??= setTimeout(() => {
      timer = null;
      client.send('input:state', state());
    }, FLUSH_MS);
  };

  const refreshRecordings = async () => {
    saved = await recordingStore.listRecordings().catch(() => saved);
    changed();
    return saved;
  };

  /** Runs one input and logs it, failed or not. */
  const logged = async (source: InputSource, kind: InputLogEntry['kind'], detail: string, run: () => Promise<void>) => {
    logId += 1;
    const entry: InputLogEntry = { id: logId, at: Date.now(), source, kind, detail };
    log.push(entry);
    if (log.length > INPUT_LOG_LIMIT) log.shift();
    try {
      await run();
    } catch (error) {
      entry.error = error instanceof Error ? error.message : String(error);
      throw error;
    } finally {
      changed();
    }
  };

  const aimedAt = (point: Point, target?: TapTarget) => (target ? `${describeTarget(target)} ${at(point)}` : at(point));

  const operations: InputOperations = {
    state,
    elements: (options) => (options?.views ? nativeInput.elementsAndViews() : nativeInput.elements()),
    tap: (point, source, target, options) =>
      logged(source, 'tap', aimedAt(point, target), () =>
        tapRecorder.send(
          { ...round(point), ...(target ? { target } : {}) },
          async () => {
            showTouch(point);
            await nativeInput.tap(round(point));
          },
          options,
        ),
      ),
    longPress: (point, durationMs, source, target, options) =>
      logged(source, 'long press', `${aimedAt(point, target)} for ${Math.round(durationMs)}ms`, () =>
        tapRecorder.send(
          { ...round(point), to: round(point), durationMs, ...(target ? { target } : {}) },
          async () => {
            showTouch(point);
            await nativeInput.longPress(round(point), durationMs);
          },
          options,
        ),
      ),
    swipe: ({ from, to, durationMs = DEFAULT_SWIPE_MS }, source, options) =>
      logged(source, 'swipe', `${at(from)} → ${at(to)} in ${Math.round(durationMs)}ms`, () =>
        tapRecorder.send(
          { ...round(from), to: round(to), durationMs },
          async () => {
            showTouch(from, to);
            await nativeInput.swipe(round(from), round(to), durationMs);
          },
          options,
        ),
      ),
    typeText: (text, source) =>
      logged(source, 'type', text === '\n' ? 'return' : JSON.stringify(text.length > 40 ? `${text.slice(0, 40)}…` : text), () => nativeInput.typeText(text)),
    deleteBackward: (count, source) => logged(source, 'delete', `×${count}`, () => nativeInput.deleteBackward(count)),
    startRecording: () => tapRecorder.start(),
    stopRecording: async (name) => {
      const summary = await tapRecorder.stop(name);
      await refreshRecordings();
      return summary;
    },
    play: (fileName, options) =>
      tapPlayer.play(
        fileName,
        async (event, cancelled) => {
          const hold = isHold(event);
          if (event.to && !hold) return operations.swipe({ from: event, to: event.to, durationMs: event.durationMs }, 'replay');
          const press = (point: Point, target?: TapTarget) =>
            hold ? operations.longPress(point, event.durationMs ?? DEFAULT_LONG_PRESS_MS, 'replay', target) : operations.tap(point, 'replay', target);
          if (!event.target) return press(event);
          const deadline = Date.now() + TARGET_WAIT_MS;
          for (;;) {
            // eslint-disable-next-line no-await-in-loop
            const { elements } = await nativeInput.elements();
            if (cancelled()) return undefined;
            const found = pickTarget(elements, event.target, event);
            if (found) return press(aimPoint(found, elements), event.target);
            if (Date.now() >= deadline) break;
            // eslint-disable-next-line no-await-in-loop
            await sleep(TARGET_POLL_MS);
          }
          await press(event, event.target);
          return `${describeTarget(event.target)} not found; pressed its recorded point`;
        },
        options,
      ),
    stopPlayback: () => tapPlayer.stop(),
    recordings: refreshRecordings,
    readRecording: (fileName) => recordingStore.readRecording(fileName),
    editRecording: async (fileName, edit) => {
      const summary = await recordingStore.editRecording(fileName, edit);
      await refreshRecordings();
      return summary;
    },
  };

  const unsubscribe = [tapRecorder.subscribe(changed), tapPlayer.subscribe(changed)];

  const subscriptions = [
    rpc.handle('attach', async ({ panelId }) => {
      if (leases.renew(panelId)) await refreshRecordings();
      return state();
    }),
    rpc.handle('detach', async ({ panelId }) => leases.release(panelId)),
    rpc.handle('screen', async ({ since, ignoreText }) => {
      const stamp = await screenStamp();
      if (stamp && stamp === since) return { stamp };
      // Kept at `since`, so the text change is still news to the next check that doesn't ignore it.
      if (stamp && since && ignoreText && viewsPart(stamp) === viewsPart(since)) return { stamp: since };
      return { stamp: stamp ?? randomId(), snapshot: await operations.elements({ views: true }) };
    }),
    rpc.handle('tap', (point) => operations.tap(point, 'panel')),
    rpc.handle('swipe', (params) => operations.swipe(params, 'panel')),
    rpc.handle('typeText', ({ text }) => operations.typeText(text, 'panel')),
    rpc.handle('deleteBackward', ({ count }) => operations.deleteBackward(Math.max(1, Math.round(count ?? 1)), 'panel')),
    rpc.handle('longPress', ({ x, y, durationMs }) =>
      operations.longPress({ x, y }, Math.max(100, Math.min(10000, durationMs ?? DEFAULT_LONG_PRESS_MS)), 'panel'),
    ),
    rpc.handle('startRecording', async () => operations.startRecording()),
    rpc.handle('stopRecording', ({ name }) => operations.stopRecording(name)),
    rpc.handle('readRecording', ({ fileName }) => operations.readRecording(fileName)),
    rpc.handle('editRecording', ({ fileName, ...edit }) => operations.editRecording(fileName, edit)),
    rpc.handle('play', async ({ fileName, ...options }) => {
      const { finished } = await operations.play(fileName, options);
      finished.catch(() => undefined);
    }),
    rpc.handle('stopPlayback', async () => operations.stopPlayback()),
    rpc.handle('renameRecording', async ({ fileName, name }) => {
      await recordingStore.renameRecording(fileName, name);
      await refreshRecordings();
    }),
    rpc.handle('deleteRecording', async ({ fileName }) => {
      await recordingStore.deleteRecording(fileName);
      await refreshRecordings();
    }),
    rpc.handle('exportRecording', async ({ fileName }) => ({ json: JSON.stringify(await recordingStore.readRecording(fileName), null, 2) })),
    rpc.handle('importRecording', async ({ json }) => {
      const summary = await recordingStore.importRecording(json);
      await refreshRecordings();
      return summary;
    }),
  ];

  return {
    operations,
    stop: () => {
      if (timer) clearTimeout(timer);
      leases.releaseAll();
      unsubscribe.forEach((stop) => stop());
      quietLogBox.agentInactive();
      subscriptions.forEach((subscription) => subscription.remove());
      rpc.close();
    },
  };
}
