"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.editedRecording = editedRecording;
exports.playbackTimes = playbackTimes;
exports.screenDistance = screenDistance;
/**
 * The recording with touches removed or cut off the end. The start and end screens move with the touches that
 * remain: a recording that now starts later starts on the screen its new first touch was made on.
 */
function editedRecording(recording, { remove = [], keepFirst }) {
    const removed = new Set(remove.map((number) => number - 1));
    let kept = recording.events.map((event, index) => ({ event, index })).filter(({ index }) => !removed.has(index));
    if (keepFirst != null)
        kept = kept.slice(0, Math.max(0, keepFirst));
    if (kept.length === 0)
        throw new Error('That would leave the recording with no touches.');
    const events = recording.events;
    const first = kept[0];
    const last = kept[kept.length - 1];
    const startScreen = first.index === 0 ? recording.startScreen : first.event.screen ?? recording.startScreen;
    const endScreen = last.index === events.length - 1 ? recording.endScreen : events[last.index + 1].screen;
    const base = first.event.t;
    const { startScreen: _start, endScreen: _end, ...rest } = recording;
    return {
        ...rest,
        ...(startScreen ? { startScreen } : {}),
        ...(endScreen ? { endScreen } : {}),
        events: kept.map(({ event }) => ({ ...event, t: event.t - base })),
    };
}
/** When each touch plays, in ms after the first. */
function playbackTimes(events, { gapMs, maxGapMs } = {}) {
    const times = [];
    events.forEach((event, index) => {
        if (index === 0) {
            times.push(0);
            return;
        }
        const recorded = Math.max(0, event.t - events[index - 1].t);
        const gap = gapMs != null ? gapMs : maxGapMs != null ? Math.min(recorded, maxGapMs) : recorded;
        times.push(times[index - 1] + gap);
    });
    return times;
}
/** The screen without its sub-screen: `Home` of `Home#Feed`. */
const routeOf = (screen) => screen.split('#')[0];
/**
 * How far the screen the app is on is from the one a touch was recorded on. Another sub-screen (after the `#`) of the
 * same screen is nearer than another screen, and a name without one matches any of them.
 */
function screenDistance(expected, actual) {
    if (actual == null || routeOf(actual) !== routeOf(expected))
        return 'route';
    return actual === expected || !actual.includes('#') || !expected.includes('#') ? 'same' : 'subtab';
}
