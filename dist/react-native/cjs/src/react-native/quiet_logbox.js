"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.quietLogBox = void 0;
const react_native_1 = require("react-native");
/** How long after its last input tool call an agent still counts as driving the app. */
const AGENT_QUIET_MS = 10 * 60 * 1000;
const reasons = new Set();
let agentTimer = null;
let quiet = false;
function apply() {
    const next = reasons.size > 0 || agentTimer != null;
    if (next === quiet)
        return;
    quiet = next;
    react_native_1.LogBox.ignoreAllLogs(next);
}
/**
 * Hides LogBox's warning and error toasts while touches are recorded, replayed or sent by an agent, since a toast
 * over the tab bar takes the taps meant for it. Logs still collect, and their toasts come back afterwards; an
 * uncaught error still opens the full-screen LogBox.
 */
exports.quietLogBox = {
    set(reason, on) {
        if (on)
            reasons.add(reason);
        else
            reasons.delete(reason);
        apply();
    },
    agentActive() {
        if (agentTimer)
            clearTimeout(agentTimer);
        agentTimer = setTimeout(() => {
            agentTimer = null;
            apply();
        }, AGENT_QUIET_MS);
        apply();
    },
    agentInactive() {
        if (agentTimer)
            clearTimeout(agentTimer);
        agentTimer = null;
        apply();
    },
};
