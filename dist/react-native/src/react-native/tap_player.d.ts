import { type PlaybackState, type PlayOptions, type RecordedTouch } from '../shared/protocol';
/** A moment to let go of the mouse before the first tap lands. */
export declare const START_DELAY_MS = 500;
/** How long a touch waits for the app to reach the screen it was recorded on, before it counts as diverged. */
export declare const SCREEN_WAIT_MS = 3000;
/** Sends one event, giving up early once `cancelled`; answers what it couldn't find when it fell back to the recorded point. */
type PerformEvent = (event: RecordedTouch, cancelled: () => boolean) => Promise<string | void>;
/**
 * Replays a saved recording through `perform`, each touch at its recorded time after the first unless paced
 * otherwise. Before each touch it checks the app is on the screen the touch was recorded on, giving it a moment
 * to get there, and stops at the first touch that would land on another screen.
 */
declare class TapPlayer {
    private state;
    private run;
    private listeners;
    getState(): PlaybackState;
    subscribe(listener: () => void): () => void;
    private set;
    private note;
    /** Resolves once started, with `finished` for when it ends; starting another stops this one. */
    play(fileName: string, perform: PerformEvent, options?: PlayOptions): Promise<{
        finished: Promise<void>;
    }>;
    private playEvents;
    stop(): void;
}
export declare const tapPlayer: TapPlayer;
export {};
