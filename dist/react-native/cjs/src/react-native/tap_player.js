"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.tapPlayer = exports.SCREEN_WAIT_MS = exports.START_DELAY_MS = void 0;
const protocol_1 = require("../shared/protocol");
const recording_edits_1 = require("./recording_edits");
const quiet_logbox_1 = require("./quiet_logbox");
const config_1 = require("./config");
const tap_recordings_store_1 = require("./tap_recordings_store");
/** A moment to let go of the mouse before the first tap lands. */
exports.START_DELAY_MS = 500;
/** How long a touch waits for the app to reach the screen it was recorded on, before it counts as diverged. */
exports.SCREEN_WAIT_MS = 3000;
/** How long it waits for the right sub-tab, which may never come when the sub-tab is named for a date or week. */
const SUBTAB_WAIT_MS = 500;
const SCREEN_POLL_MS = 100;
const IDLE = { fileName: null, index: 0, total: 0, misses: [], diverged: null };
const sleep = (ms) => new Promise((resolve) => {
    setTimeout(resolve, ms);
});
const touchMs = (event) => (event.to ? event.durationMs ?? ((0, protocol_1.isHold)(event) ? protocol_1.DEFAULT_LONG_PRESS_MS : protocol_1.DEFAULT_SWIPE_MS) : 0);
/** Waits for the app to reach `expected`, answering how close it got and how long it waited. */
async function awaitScreen(expected) {
    const startedAt = Date.now();
    for (;;) {
        const actual = (0, config_1.currentScreen)();
        const distance = (0, recording_edits_1.screenDistance)(expected, actual);
        const waited = Date.now() - startedAt;
        if (distance === 'same' || waited >= (distance === 'route' ? exports.SCREEN_WAIT_MS : SUBTAB_WAIT_MS))
            return { distance, actual, waited };
        // eslint-disable-next-line no-await-in-loop
        await sleep(SCREEN_POLL_MS);
    }
}
/**
 * Replays a saved recording through `perform`, each touch at its recorded time after the first unless paced
 * otherwise. Before each touch it checks the app is on the screen the touch was recorded on, giving it a moment
 * to get there, and stops at the first touch that would land on another screen.
 */
class TapPlayer {
    state = IDLE;
    run = 0;
    listeners = new Set();
    getState() {
        return this.state;
    }
    subscribe(listener) {
        this.listeners.add(listener);
        return () => {
            this.listeners.delete(listener);
        };
    }
    set(state) {
        this.state = state;
        quiet_logbox_1.quietLogBox.set('replay', !!state.fileName);
        this.listeners.forEach((listener) => listener());
    }
    note(run, miss) {
        if (run === this.run)
            this.set({ ...this.state, misses: [...this.state.misses, miss] });
    }
    /** Resolves once started, with `finished` for when it ends; starting another stops this one. */
    async play(fileName, perform, options = {}) {
        const recording = await (0, tap_recordings_store_1.readRecording)(fileName);
        if (!recording.events?.length)
            throw new Error('The recording has no taps.');
        const here = (0, config_1.currentScreen)();
        const { startScreen } = recording;
        if (!options.force && startScreen && here && (0, recording_edits_1.screenDistance)(startScreen, here) === 'route') {
            throw new Error(`This recording starts on ${startScreen}, and the app is on ${here}. Go there first, or pass force.`);
        }
        this.run += 1;
        const run = this.run;
        this.set({ fileName, index: 0, total: recording.events.length, misses: [], diverged: null });
        return { finished: this.playEvents(run, recording, perform, options) };
    }
    async playEvents(run, { events, endScreen }, perform, { force = false, keepGoing = false, gapMs, maxGapMs }) {
        const times = (0, recording_edits_1.playbackTimes)(events, { gapMs, maxGapMs });
        let startedAt = Date.now() + exports.START_DELAY_MS;
        const stopAtDivergence = !keepGoing && !force;
        const cancelled = () => run !== this.run;
        /** Answers false when the replay should stop here. */
        const check = async (expected, index, atEnd) => {
            if (!expected)
                return true;
            const { distance, actual, waited } = await awaitScreen(expected);
            if (cancelled())
                return false;
            startedAt += waited;
            const where = atEnd ? `after #${index}` : `#${index}`;
            if (distance === 'subtab')
                this.note(run, `${where} recorded on ${expected}, the app was on ${actual}`);
            if (distance !== 'route')
                return true;
            if (!this.state.diverged) {
                const diverged = { index, ...(atEnd ? { atEnd } : {}), expected, actual, stopped: stopAtDivergence };
                this.set({ ...this.state, diverged });
            }
            else
                this.note(run, `${where} recorded on ${expected}, the app was on ${actual}`);
            return !stopAtDivergence;
        };
        try {
            for (let i = 0; i < events.length; i += 1) {
                const event = events[i];
                // eslint-disable-next-line no-await-in-loop
                await sleep(Math.max(0, startedAt + times[i] - Date.now()));
                if (cancelled())
                    return;
                // eslint-disable-next-line no-await-in-loop
                if (!(await check(event.screen, i + 1, false)))
                    return;
                this.set({ ...this.state, index: i + 1 });
                const performedAt = Date.now();
                // eslint-disable-next-line no-await-in-loop
                const missed = await perform(event, cancelled).catch((error) => (error instanceof Error ? error.message : String(error)));
                if (cancelled())
                    return;
                startedAt += Math.max(0, Date.now() - performedAt - touchMs(event));
                if (missed)
                    this.note(run, `#${i + 1} ${missed}`);
            }
            await check(endScreen, events.length, true);
        }
        finally {
            if (run === this.run)
                this.set({ ...IDLE, misses: this.state.misses, diverged: this.state.diverged });
        }
    }
    stop() {
        if (!this.state.fileName)
            return;
        this.run += 1;
        this.set({ ...IDLE, misses: this.state.misses, diverged: this.state.diverged });
    }
}
exports.tapPlayer = new TapPlayer();
