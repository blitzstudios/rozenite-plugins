import type { RecordedTouch, RecordingSummary } from '../shared/protocol';
/**
 * Records taps, long presses and swipes anywhere in the app. Inputs the Input tools send are recorded as they were
 * sent, aimed at an element when they were; a finger's come from the `subscribeToTouches` option.
 */
declare class TapRecorder {
    private events;
    private startedAt;
    private startScreen;
    private down;
    private sending;
    private unsubscribe;
    private recording;
    private listeners;
    isRecording(): boolean;
    count(): number;
    subscribe(listener: () => void): () => void;
    private notify;
    private push;
    /**
     * Runs an input the tools send, recording it as sent rather than as the touches it produces, once it has gone
     * in. With `record` false it's left out, for the taps that set a recording up rather than belong in it.
     */
    send(event: Omit<RecordedTouch, 't' | 'screen'>, run: () => Promise<void>, { record }?: {
        record?: boolean | undefined;
    }): Promise<void>;
    private onTouch;
    start(): void;
    /**
     * Stops and saves what was recorded, or saves nothing and answers null when no touch was. It starts where its
     * first touch was made, which is later than where recording started when setup taps were left out.
     */
    stop(name?: string): Promise<RecordingSummary | null>;
}
export declare const tapRecorder: TapRecorder;
export {};
