import type { RozeniteDevToolsClient } from '@rozenite/plugin-bridge';
import { type ElementsSnapshot, type InputEventMap, type InputSource, type InputState, type PlayOptions, type Point, type Recording, type RecordingEdit, type RecordingSummary, type SwipeParams, type TapTarget } from '../shared/protocol';
/** `record: false` leaves an input out of the recording being made, for the taps that set it up. */
type SendOptions = {
    record?: boolean;
};
/** What the Input panel's calls and the agent tools do, shared so the two can't drift. */
export type InputOperations = {
    state: () => InputState;
    /** With `views`, every view as drawn too, for the wireframe. */
    elements: (options?: {
        views?: boolean;
    }) => Promise<ElementsSnapshot>;
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
    play: (fileName: string, options?: PlayOptions) => Promise<{
        finished: Promise<void>;
    }>;
    stopPlayback: () => void;
    recordings: () => Promise<RecordingSummary[]>;
    readRecording: (fileName: string) => Promise<Recording>;
    editRecording: (fileName: string, edit: RecordingEdit) => Promise<RecordingSummary>;
};
export type InputBridge = {
    operations: InputOperations;
    stop: () => void;
};
/** Answers the Input panel and, while one is attached, pushes the log, the recorder and playback as they change. */
export declare function startInputBridge(client: RozeniteDevToolsClient<InputEventMap>): InputBridge;
export {};
