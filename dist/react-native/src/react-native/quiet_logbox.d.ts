/**
 * Hides LogBox's warning and error toasts while touches are recorded, replayed or sent by an agent, since a toast
 * over the tab bar takes the taps meant for it. Logs still collect, and their toasts come back afterwards; an
 * uncaught error still opens the full-screen LogBox.
 */
export declare const quietLogBox: {
    set(reason: "recording" | "replay", on: boolean): void;
    agentActive(): void;
    agentInactive(): void;
};
