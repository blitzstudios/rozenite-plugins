import { Dimensions, PixelRatio } from 'react-native';
import { currentScreen, inputOptions } from './config';
import { quietLogBox } from './quiet_logbox';
import { writeRecording } from './tap_recordings_store';
/** A touch that moves further than this between down and up is a swipe. */
const SWIPE_SLOP = 10;
/** A touch held still this long is a long press. */
const LONG_PRESS_MIN_MS = 500;
/** How long after a sent input ends its own touches may still arrive from the root. */
const SENT_TAIL_MS = 150;
/**
 * Records taps, long presses and swipes anywhere in the app. Inputs the Input tools send are recorded as they were
 * sent, aimed at an element when they were; a finger's come from the `subscribeToTouches` option.
 */
class TapRecorder {
    events = [];
    startedAt = null;
    startScreen = null;
    down = null;
    sending = 0;
    unsubscribe = null;
    recording = false;
    listeners = new Set();
    isRecording() {
        return this.recording;
    }
    count() {
        return this.events.length;
    }
    subscribe(listener) {
        this.listeners.add(listener);
        return () => {
            this.listeners.delete(listener);
        };
    }
    notify() {
        this.listeners.forEach((listener) => listener());
    }
    push(event, at, screen) {
        this.startedAt ??= at;
        this.events.push({ ...event, t: at - this.startedAt, ...(screen ? { screen } : {}) });
        this.notify();
    }
    /**
     * Runs an input the tools send, recording it as sent rather than as the touches it produces, once it has gone
     * in. With `record` false it's left out, for the taps that set a recording up rather than belong in it.
     */
    async send(event, run, { record = true } = {}) {
        if (!this.recording)
            return run();
        this.sending += 1;
        this.down = null;
        const at = Date.now();
        const screen = currentScreen();
        try {
            await run();
            if (record && this.recording)
                this.push(event, at, screen);
        }
        finally {
            setTimeout(() => {
                this.sending -= 1;
            }, SENT_TAIL_MS);
        }
    }
    onTouch({ phase, point, touches }) {
        if (this.sending > 0)
            return;
        const now = Date.now();
        if (phase === 'start') {
            this.down = touches > 1 ? null : { point, at: now, screen: currentScreen() };
            return;
        }
        const { down } = this;
        this.down = null;
        if (!down)
            return;
        const durationMs = now - down.at;
        const moved = Math.hypot(point.x - down.point.x, point.y - down.point.y) > SWIPE_SLOP;
        const to = moved ? point : durationMs >= LONG_PRESS_MIN_MS ? down.point : null;
        this.push({ ...down.point, ...(to ? { to, durationMs } : {}) }, down.at, down.screen);
    }
    start() {
        if (this.recording)
            return;
        this.recording = true;
        this.events = [];
        this.startedAt = null;
        this.startScreen = currentScreen();
        this.down = null;
        this.unsubscribe = inputOptions().subscribeToTouches?.((touch) => this.onTouch(touch)) ?? null;
        quietLogBox.set('recording', true);
        this.notify();
    }
    /**
     * Stops and saves what was recorded, or saves nothing and answers null when no touch was. It starts where its
     * first touch was made, which is later than where recording started when setup taps were left out.
     */
    async stop(name) {
        if (!this.recording)
            return null;
        this.recording = false;
        this.unsubscribe?.();
        this.unsubscribe = null;
        quietLogBox.set('recording', false);
        const { events } = this;
        const startScreen = events[0]?.screen ?? this.startScreen;
        const endScreen = currentScreen();
        this.events = [];
        this.notify();
        if (events.length === 0)
            return null;
        const window = Dimensions.get('window');
        return writeRecording({
            name: name?.trim() || `Recording ${new Date().toLocaleString()}`,
            createdAt: new Date().toISOString(),
            screen: { width: window.width, height: window.height, scale: PixelRatio.get() },
            ...(startScreen ? { startScreen } : {}),
            ...(endScreen ? { endScreen } : {}),
            events,
        });
    }
}
export const tapRecorder = new TapRecorder();
