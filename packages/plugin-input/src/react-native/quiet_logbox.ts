import { LogBox } from 'react-native';

/** How long after its last input tool call an agent still counts as driving the app. */
const AGENT_QUIET_MS = 10 * 60 * 1000;

const reasons = new Set<string>();
let agentTimer: ReturnType<typeof setTimeout> | null = null;
let quiet = false;

function apply(): void {
  const next = reasons.size > 0 || agentTimer != null;
  if (next === quiet) return;
  quiet = next;
  LogBox.ignoreAllLogs(next);
}

/**
 * Hides LogBox's warning and error toasts while touches are recorded, replayed or sent by an agent, since a toast
 * over the tab bar takes the taps meant for it. Logs still collect, and their toasts come back afterwards; an
 * uncaught error still opens the full-screen LogBox.
 */
export const quietLogBox = {
  set(reason: 'recording' | 'replay', on: boolean): void {
    if (on) reasons.add(reason);
    else reasons.delete(reason);
    apply();
  },
  agentActive(): void {
    if (agentTimer) clearTimeout(agentTimer);
    agentTimer = setTimeout(() => {
      agentTimer = null;
      apply();
    }, AGENT_QUIET_MS);
    apply();
  },
  agentInactive(): void {
    if (agentTimer) clearTimeout(agentTimer);
    agentTimer = null;
    apply();
  },
};
