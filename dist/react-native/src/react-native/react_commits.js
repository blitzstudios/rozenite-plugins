let commits = 0;
let counting;
/**
 * How many times React has committed, counted through the DevTools hook React calls on each commit, or null without
 * one. A screen's text changes with a commit, so this and the native views' fingerprint tell when the screen changed.
 */
export function reactCommitCount() {
    const hook = global.__REACT_DEVTOOLS_GLOBAL_HOOK__;
    if (typeof hook?.onCommitFiberRoot !== 'function')
        return null;
    if (hook.onCommitFiberRoot !== counting) {
        const original = hook.onCommitFiberRoot;
        counting = function countCommit(...args) {
            commits += 1;
            return original.apply(this, args);
        };
        hook.onCommitFiberRoot = counting;
        // Commits since the hook was replaced went uncounted.
        commits += 1;
    }
    return commits;
}
