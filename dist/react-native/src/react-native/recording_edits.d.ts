import type { PlayOptions, Recording, RecordingEdit } from '../shared/protocol';
/**
 * The recording with touches removed or cut off the end. The start and end screens move with the touches that
 * remain: a recording that now starts later starts on the screen its new first touch was made on.
 */
export declare function editedRecording(recording: Recording, { remove, keepFirst }: RecordingEdit): Recording;
/** When each touch plays, in ms after the first. */
export declare function playbackTimes(events: {
    t: number;
}[], { gapMs, maxGapMs }?: Pick<PlayOptions, 'gapMs' | 'maxGapMs'>): number[];
/**
 * How far the screen the app is on is from the one a touch was recorded on. Another sub-screen (after the `#`) of the
 * same screen is nearer than another screen, and a name without one matches any of them.
 */
export declare function screenDistance(expected: string, actual: string | null): 'same' | 'subtab' | 'route';
