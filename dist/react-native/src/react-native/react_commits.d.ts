/**
 * How many times React has committed, counted through the DevTools hook React calls on each commit, or null without
 * one. A screen's text changes with a commit, so this and the native views' fingerprint tell when the screen changed.
 */
export declare function reactCommitCount(): number | null;
