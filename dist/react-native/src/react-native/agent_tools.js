import { AppState, Keyboard, PixelRatio } from 'react-native';
import { DEFAULT_LONG_PRESS_MS, DEFAULT_SWIPE_MS, isHold, } from '../shared/protocol';
import { aimPoint, at, describeTarget, diff, header, line, preferTappable, RefTable, signature, tapTargetOf, visible, } from './snapshot';
import { quietLogBox } from './quiet_logbox';
import { SCREEN_WAIT_MS, START_DELAY_MS } from './tap_player';
import { currentScreen } from './config';
const LIST_LIMIT = 100;
const LIST_MAX = 600;
const WAIT_DEFAULT_MS = 5000;
/** Rozenite abandons a tool call after 30 s, so nothing here may wait that long. */
const CALL_BUDGET_MS = 25000;
const POLL_MS = 150;
const SETTLE_DEFAULT_MS = 3000;
const SETTLE_MAX_MS = 10000;
/** How long the screen must stay as it was before a touch to count as "no change". */
const NO_CHANGE_MS = 700;
const SCROLL_FRACTION = 0.6;
const REF = /^e\d+$/;
const requiredNum = (value, name) => {
    if (typeof value !== 'number' || !Number.isFinite(value))
        throw new Error(`${name} must be a number`);
    return value;
};
const clampNum = (value, fallback, min, max) => Math.max(min, Math.min(max, typeof value === 'number' && Number.isFinite(value) ? value : fallback));
const sleep = (ms) => new Promise((resolve) => {
    setTimeout(resolve, ms);
});
/** Whether `promise` resolves within `ms`. */
const resolvesWithin = (promise, ms) => new Promise((resolve, reject) => {
    const timeout = setTimeout(() => resolve(false), ms);
    promise.finally(() => clearTimeout(timeout)).then(() => resolve(true), reject);
});
const lower = (value) => value?.toLowerCase() ?? '';
/** How well `element` matches: an exact test id first, then an exact label, then either containing it; null for no match. */
function score(element, match, exact) {
    const needle = match.toLowerCase();
    if (element.testID === match)
        return 0;
    if (lower(element.label) === needle)
        return 1;
    if (exact)
        return null;
    if (lower(element.testID).includes(needle))
        return 2;
    if (lower(element.label).includes(needle))
        return 3;
    return null;
}
/** Best first: by match, then as `preferTappable` orders them. */
function find(entries, match, exact) {
    return entries
        .map((entry) => ({ entry, rank: score(entry.element, match, exact) }))
        .filter((candidate) => candidate.rank != null)
        .sort((a, b) => a.rank - b.rank || preferTappable(a.entry.element, b.entry.element))
        .map((candidate) => candidate.entry);
}
const asJson = ({ ref, element }, verbose) => ({
    ref,
    ...(element.testID ? { testID: element.testID } : {}),
    ...(element.label ? { label: element.label } : {}),
    ...(element.value ? { value: element.value } : {}),
    ...(element.traits.length ? { traits: element.traits } : {}),
    center: element.center,
    frame: element.frame,
    ...(element.hittable === false ? { hittable: false } : {}),
    window: element.window,
    ...(verbose ? { type: element.type } : {}),
});
const describeTouch = (touch, index) => {
    const press = isHold(touch) ? `long press ${Math.round(touch.durationMs ?? DEFAULT_LONG_PRESS_MS)}ms` : 'tap';
    const what = touch.to && !isHold(touch)
        ? `swipe ${at(touch)} → ${at(touch.to)}`
        : touch.target
            ? `${press} ${describeTarget(touch.target)} @${at(touch)}`
            : `${press} ${at(touch)}`;
    return `#${index + 1} +${(touch.t / 1000).toFixed(1)}s ${what}${touch.screen ? ` on ${touch.screen}` : ''}`;
};
const nameOf = (element) => element.testID ?? element.label ?? `unlabeled @${at(element.center)}`;
const context = (snapshot) => ({
    screen: currentScreen(),
    appState: AppState.currentState,
    keyboard: Keyboard.isVisible(),
    size: snapshot.screen,
    scale: PixelRatio.get(),
});
const clipTo = (frame, bounds) => {
    const x = Math.max(frame.x, bounds.x);
    const y = Math.max(frame.y, bounds.y);
    return {
        x,
        y,
        width: Math.max(0, Math.min(frame.x + frame.width, bounds.x + bounds.width) - x),
        height: Math.max(0, Math.min(frame.y + frame.height, bounds.y + bounds.height) - y),
    };
};
const stateOf = (look) => `${look.context.screen}|${look.context.appState}|${look.context.keyboard}\n${signature(look.snapshot.elements)}`;
const MATCH = {
    type: 'string',
    description: 'A ref from list-elements (e12), or a test id or accessibility label: an exact test id wins, then an exact label, then either containing this text, case-insensitively.',
};
const EXACT = { type: 'boolean', description: 'Only an exact test id or label, not one containing the text.' };
const X = { type: 'number', description: 'Points from the left of the app window.' };
const Y = { type: 'number', description: 'Points from the top of the app window.' };
const DURATION = { type: 'number', description: `How long the finger moves, in ms; ${DEFAULT_SWIPE_MS} by default. Shorter flings further.` };
const OBSERVE = {
    observe: {
        type: 'boolean',
        description: 'Wait for the screen to settle and return what changed; true by default. False returns as soon as the input is sent.',
    },
    settleMs: { type: 'number', description: `The longest to wait for the screen to stop changing; ${SETTLE_DEFAULT_MS} by default, at most ${SETTLE_MAX_MS}.` },
};
const RECORD = {
    type: 'boolean',
    description: 'While recording, false leaves this touch out of the recording: for the taps that set a recording up, such as dismissing a toast or getting to its first screen. True by default.',
};
const TOUCH_NOTE = 'Then waits for the screen to settle and returns the header and what changed as list-elements lines: + appeared, - gone, ~ new value or state.';
const sendOptions = (args) => (args.record === false ? { record: false } : undefined);
const LINE_FORMAT = 'Each line is: ref, kind and traits (button, field, header, selected, disabled, …), "label" and #testID, or unlabeled when it has neither, ="value", @x,y the center a tap lands on, WxH, w<n> for a window above the base one (a modal or sheet), covered.';
/** Agent tools for the Input plugin: what is on screen, and taps, swipes and text into the app. */
export function inputAgentTools(ops) {
    const refs = new RefTable();
    const isRef = (match) => REF.test(match) && refs.known(match);
    async function look(includeCovered = false, views = false) {
        const snapshot = await ops.elements({ views });
        const all = refs.assign(snapshot.elements);
        return { snapshot, all, shown: visible(all, includeCovered), context: context(snapshot) };
    }
    /** What `match` names on screen, best first; a ref names one. Fails, listing what is on screen, when nothing matches. */
    async function target(match, exact) {
        const before = await look();
        if (isRef(match)) {
            const element = refs.resolve(match, before.snapshot.elements);
            if (!element)
                throw new Error(`${match} is no longer on screen; call list-elements`);
            return { matches: [{ ref: match, element }], before };
        }
        const matches = find(before.all, match, exact);
        if (matches.length)
            return { matches, before };
        const some = before.shown.slice(0, 20).map(({ element }) => nameOf(element));
        throw new Error(`Nothing on screen matches "${match}". On screen: ${JSON.stringify(some)}${before.shown.length > some.length ? ' …' : ''}`);
    }
    /** The element `match` or `ref` names, the `index`th best; null when neither is given. */
    async function aim(args) {
        const match = args.match || args.ref;
        if (typeof match !== 'string' || !match)
            return null;
        const { matches, before } = await target(match, args.exact === true);
        const entry = matches[Math.floor(clampNum(args.index, 0, 0, matches.length - 1))];
        const point = aimPoint(entry.element, before.snapshot.elements);
        const atText = point === entry.element.center ? '' : ` at its text ${at(point)}`;
        return { entry, point, target: tapTargetOf(entry.element), described: `${line(entry)}${atText}`, others: matches.length - 1, before };
    }
    /** Sends an input, then waits for the screen to settle and describes what changed. */
    async function act(args, did, perform, before) {
        if (args.observe === false) {
            await perform();
            return { did };
        }
        const start = before ?? (await look());
        await perform();
        const timeoutMs = clampNum(args.settleMs, SETTLE_DEFAULT_MS, 0, SETTLE_MAX_MS);
        const quietMs = Math.min(NO_CHANGE_MS, timeoutMs);
        const startedAt = Date.now();
        const initial = stateOf(start);
        let previous = null;
        let now;
        let settled = true;
        for (;;) {
            // eslint-disable-next-line no-await-in-loop
            await sleep(POLL_MS);
            // eslint-disable-next-line no-await-in-loop
            now = await look();
            const state = stateOf(now);
            const waitedMs = Date.now() - startedAt;
            if (state === initial ? waitedMs >= quietMs : state === previous)
                break;
            if (waitedMs >= timeoutMs) {
                settled = false;
                break;
            }
            previous = state;
        }
        const screen = start.context.screen && start.context.screen !== now.context.screen ? `${start.context.screen} → ${now.context.screen}` : now.context.screen;
        return {
            did,
            lines: [...header({ ...now.context, screen }), ...diff(start.shown, now.shown)],
            waitedMs: Date.now() - startedAt,
            ...(settled ? {} : { settled: false }),
        };
    }
    const tools = [
        {
            tool: {
                name: 'list-elements',
                description: `What is on screen, as text: a header line (screen route, app state, keyboard, size in points and scale), then one line per view with a test id, an accessibility label, or a button role (unlabeled buttons show as \`unlabeled\`), topmost window last. ${LINE_FORMAT} Refs stay the same while an element stays on screen; pass one to tap-element. Use this instead of a screenshot to find what to tap and to check what a screen shows; take a screenshot only for how it looks, or when the header says the app is not active.`,
                inputSchema: {
                    type: 'object',
                    properties: {
                        match: { type: 'string', description: 'Only elements whose test id or label contains this text, case-insensitively.' },
                        includeCovered: { type: 'boolean', description: 'Also list elements something is drawn over (iOS), such as the screen under a modal.' },
                        limit: { type: 'number', description: `The most to return; ${LIST_LIMIT} by default, at most ${LIST_MAX}.` },
                        format: { type: 'string', enum: ['lines', 'json'], description: 'lines by default; json gives each element as an object with its full frame.' },
                        verbose: { type: 'boolean', description: 'With format json, include each one’s native view class.' },
                        views: {
                            type: 'boolean',
                            description: 'With format json, also every view as drawn, in paint order: its frame, background, border, corner radius, and for text its text, size, weight, color and alignment. For checking how something looks without a screenshot.',
                        },
                    },
                },
                readOnly: true,
            },
            handler: async (args) => {
                const json = args.format === 'json';
                const views = json && args.views === true;
                const current = await look(args.includeCovered === true, views);
                const match = typeof args.match === 'string' && args.match ? args.match : undefined;
                const kept = match ? find(current.shown, match, false) : current.shown;
                const limit = clampNum(args.limit, LIST_LIMIT, 1, LIST_MAX);
                const counts = {
                    shown: Math.min(kept.length, limit),
                    hidden: current.all.length - current.shown.length,
                    truncated: current.snapshot.truncated || kept.length > limit,
                };
                if (!json)
                    return { lines: [...header(current.context, counts), ...kept.slice(0, limit).map(line)] };
                return {
                    header: header(current.context, counts),
                    screen: current.snapshot.screen,
                    elements: kept.slice(0, limit).map((entry) => asJson(entry, args.verbose === true)),
                    ...(views ? { views: current.snapshot.views ?? null, viewsTruncated: current.snapshot.viewsTruncated ?? false } : {}),
                };
            },
        },
        {
            tool: {
                name: 'tap-element',
                description: `Taps an element by ref, or the one best matching a test id or label, at the center of the part of it on screen; a card (a button 80 points or taller) at its biggest text instead, since its middle is often an image or video that opens a viewer. Prefers one a tap can reach, a button over its own text, and the topmost window. Fails, listing what is on screen, when nothing matches. ${TOUCH_NOTE}`,
                inputSchema: {
                    type: 'object',
                    properties: {
                        match: MATCH,
                        ref: { type: 'string', description: 'The same as match, for a ref.' },
                        exact: EXACT,
                        index: { type: 'number', description: 'Which of several matches, best first; 0 by default.' },
                        record: RECORD,
                        ...OBSERVE,
                    },
                },
                destructive: true,
            },
            handler: async (args) => {
                const aimed = await aim(args);
                if (!aimed)
                    throw new Error('Pass match: a ref (e12), test id or label');
                const result = await act(args, `tapped ${aimed.described}`, () => ops.tap(aimed.point, 'agent', aimed.target, sendOptions(args)), aimed.before);
                return aimed.others > 0 ? { ...result, otherMatches: aimed.others } : result;
            },
        },
        {
            tool: {
                name: 'tap',
                description: `Taps a point, in points from the app window's top left (pageX/pageY). ${TOUCH_NOTE}`,
                inputSchema: { type: 'object', properties: { x: X, y: Y, record: RECORD, ...OBSERVE }, required: ['x', 'y'] },
                destructive: true,
            },
            handler: async (args) => {
                const point = { x: requiredNum(args.x, 'x'), y: requiredNum(args.y, 'y') };
                return act(args, `tapped ${at(point)}`, () => ops.tap(point, 'agent', undefined, sendOptions(args)));
            },
        },
        {
            tool: {
                name: 'long-press',
                description: `Presses and holds an element (match or ref, found as tap-element finds it) or a point (x, y) for durationMs, ${DEFAULT_LONG_PRESS_MS} ms by default: for context menus, reorder handles and anything else that waits for a long press. Recorded like a tap, so a replay finds the element again. ${TOUCH_NOTE}`,
                inputSchema: {
                    type: 'object',
                    properties: {
                        match: MATCH,
                        ref: { type: 'string', description: 'The same as match, for a ref.' },
                        exact: EXACT,
                        x: X,
                        y: Y,
                        durationMs: { type: 'number', description: `How long to hold, in ms; ${DEFAULT_LONG_PRESS_MS} by default.` },
                        record: RECORD,
                        ...OBSERVE,
                    },
                },
                destructive: true,
            },
            handler: async (args) => {
                const durationMs = clampNum(args.durationMs, DEFAULT_LONG_PRESS_MS, 100, 10000);
                const aimed = await aim(args);
                if (aimed) {
                    return act(args, `long-pressed ${aimed.described} for ${durationMs}ms`, () => ops.longPress(aimed.point, durationMs, 'agent', aimed.target, sendOptions(args)), aimed.before);
                }
                if (args.x === undefined && args.y === undefined)
                    throw new Error('Pass match, ref, or x and y');
                const point = { x: requiredNum(args.x, 'x'), y: requiredNum(args.y, 'y') };
                return act(args, `long-pressed ${at(point)} for ${durationMs}ms`, () => ops.longPress(point, durationMs, 'agent', undefined, sendOptions(args)));
            },
        },
        {
            tool: {
                name: 'swipe',
                description: `Drags a finger from one point to another. To see what is below, swipe upward (toY < fromY), or use scroll. ${TOUCH_NOTE}`,
                inputSchema: {
                    type: 'object',
                    properties: { fromX: X, fromY: Y, toX: X, toY: Y, durationMs: DURATION, record: RECORD, ...OBSERVE },
                    required: ['fromX', 'fromY', 'toX', 'toY'],
                },
                destructive: true,
            },
            handler: async (args) => {
                const from = { x: requiredNum(args.fromX, 'fromX'), y: requiredNum(args.fromY, 'fromY') };
                const to = { x: requiredNum(args.toX, 'toX'), y: requiredNum(args.toY, 'toY') };
                const durationMs = clampNum(args.durationMs, DEFAULT_SWIPE_MS, 20, 5000);
                return act(args, `swiped ${at(from)} → ${at(to)}`, () => ops.swipe({ from, to, durationMs }, 'agent', sendOptions(args)));
            },
        },
        {
            tool: {
                name: 'scroll',
                description: `Scrolls the screen, or the element matching within, by swiping across ${Math.round(SCROLL_FRACTION * 100)}% of it. direction is where you want to see more of: "down" shows what is below. ${TOUCH_NOTE}`,
                inputSchema: {
                    type: 'object',
                    properties: {
                        direction: { type: 'string', enum: ['up', 'down', 'left', 'right'] },
                        within: { ...MATCH, description: 'A ref, test id or label of the scroll view, list or carousel to scroll; the whole screen by default.' },
                        fraction: { type: 'number', description: `How much of it to swipe across, from 0.1 to 0.9; ${SCROLL_FRACTION} by default.` },
                        durationMs: DURATION,
                        record: RECORD,
                        ...OBSERVE,
                    },
                    required: ['direction'],
                },
                destructive: true,
            },
            handler: async (args) => {
                const direction = String(args.direction);
                if (!['up', 'down', 'left', 'right'].includes(direction))
                    throw new Error('direction must be up, down, left or right');
                const scope = typeof args.within === 'string' && args.within ? await target(args.within, false) : null;
                const within = scope?.matches[0];
                const before = scope?.before ?? (await look());
                const area = within ? clipTo(within.element.frame, before.snapshot.screen) : before.snapshot.screen;
                const fraction = clampNum(args.fraction, SCROLL_FRACTION, 0.1, 0.9);
                const center = { x: area.x + area.width / 2, y: area.y + area.height / 2 };
                const dx = direction === 'right' ? -1 : direction === 'left' ? 1 : 0;
                const dy = direction === 'down' ? -1 : direction === 'up' ? 1 : 0;
                const half = { x: (area.width * fraction) / 2, y: (area.height * fraction) / 2 };
                const from = { x: center.x - dx * half.x, y: center.y - dy * half.y };
                const to = { x: center.x + dx * half.x, y: center.y + dy * half.y };
                const durationMs = clampNum(args.durationMs, DEFAULT_SWIPE_MS, 20, 5000);
                return act(args, `scrolled ${direction}${within ? ` in ${within.ref}` : ''}`, () => ops.swipe({ from, to, durationMs }, 'agent', sendOptions(args)), before);
            },
        },
        {
            tool: {
                name: 'type-text',
                description: 'Types text into the focused text field, at its cursor, and returns what changed. Tap the field first (tap-element) to focus it. "\\n" is the return key, which submits a single-line field.',
                inputSchema: {
                    type: 'object',
                    properties: {
                        text: { type: 'string' },
                        backspaces: {
                            type: 'number',
                            description: 'Press delete this many times before typing: a selection goes first, then the characters before the cursor.',
                        },
                        ...OBSERVE,
                    },
                },
                destructive: true,
            },
            handler: async (args) => {
                const text = typeof args.text === 'string' ? args.text : '';
                const backspaces = Math.floor(clampNum(args.backspaces, 0, 0, 1000));
                if (!text && !backspaces)
                    throw new Error('Pass text, backspaces or both');
                const did = [backspaces ? `deleted ${backspaces}` : '', text ? `typed ${JSON.stringify(text)}` : ''].filter(Boolean).join(', then ');
                return act(args, did, async () => {
                    if (backspaces)
                        await ops.deleteBackward(backspaces, 'agent');
                    if (text)
                        await ops.typeText(text, 'agent');
                });
            },
        },
        {
            tool: {
                name: 'wait-for-element',
                description: 'Waits until an element matching a ref, test id or label is on screen, not covered and done moving, and returns its line. For something that takes a while, like data loading; after a tap, the tap already waits for the screen to settle. With gone: true, waits until none is; a screen left mounted under the next one counts as gone.',
                inputSchema: {
                    type: 'object',
                    properties: {
                        match: MATCH,
                        exact: EXACT,
                        gone: { type: 'boolean', description: 'Wait until nothing matches instead.' },
                        timeoutMs: { type: 'number', description: `${WAIT_DEFAULT_MS} by default, at most ${CALL_BUDGET_MS}.` },
                    },
                    required: ['match'],
                },
                readOnly: true,
            },
            handler: async (args) => {
                const match = String(args.match);
                const gone = args.gone === true;
                const timeoutMs = clampNum(args.timeoutMs, WAIT_DEFAULT_MS, 0, CALL_BUDGET_MS);
                const startedAt = Date.now();
                let lastFrame = null;
                for (;;) {
                    // eslint-disable-next-line no-await-in-loop
                    const current = await look();
                    const found = isRef(match) ? current.shown.filter((entry) => entry.ref === match) : find(current.shown, match, args.exact === true);
                    const waitedMs = Date.now() - startedAt;
                    if (gone && found.length === 0)
                        return { waitedMs };
                    // A screen sliding in matches before it lands, so wait for the same frame twice running.
                    const frame = found[0] ? JSON.stringify(found[0].element.frame) : null;
                    if (!gone && frame && frame === lastFrame)
                        return { waitedMs, element: line(found[0]) };
                    lastFrame = frame;
                    if (waitedMs >= timeoutMs) {
                        throw new Error(`After ${waitedMs}ms, "${match}" is ${gone ? 'still on screen' : frame ? 'still moving' : 'not on screen'}`);
                    }
                    // eslint-disable-next-line no-await-in-loop
                    await sleep(POLL_MS);
                }
            },
        },
        {
            tool: {
                name: 'start-recording',
                description: "Starts recording the taps, long presses and swipes in the app, to save with stop-recording and replay with play-recording; typing is not recorded. What these tools send is recorded exactly as sent, tap-element taps by the element they matched; pass record: false on a touch that only sets the recording up. A finger's touches inside an RN <Modal> are missed. Each touch notes the screen it was made on, so a replay can tell when it has gone off course, and a replay must start on the screen the first touch was made on.",
                inputSchema: { type: 'object', properties: {} },
            },
            handler: () => {
                ops.startRecording();
                return { recording: true };
            },
        },
        {
            tool: {
                name: 'stop-recording',
                description: 'Stops recording and saves it; returns the saved recording, or null when nothing was touched.',
                inputSchema: { type: 'object', properties: { name: { type: 'string' } } },
            },
            handler: async (args) => ({ saved: await ops.stopRecording(typeof args.name === 'string' ? args.name : undefined) }),
        },
        {
            tool: {
                name: 'list-recordings',
                description: 'The tap recordings saved on this device, newest first.',
                inputSchema: { type: 'object', properties: {} },
                readOnly: true,
                idempotent: true,
            },
            handler: () => ops.recordings(),
        },
        {
            tool: {
                name: 'show-recording',
                description: 'The touches in a saved recording, one line each: its number, when it was made, what it was and the screen it was made on. Use the numbers with edit-recording.',
                inputSchema: { type: 'object', properties: { fileName: { type: 'string' } }, required: ['fileName'] },
                readOnly: true,
                idempotent: true,
            },
            handler: async (args) => {
                const recording = await ops.readRecording(String(args.fileName));
                return {
                    name: recording.name,
                    startScreen: recording.startScreen ?? null,
                    endScreen: recording.endScreen ?? null,
                    touches: recording.events.map(describeTouch),
                };
            },
        },
        {
            tool: {
                name: 'edit-recording',
                description: 'Removes touches from a saved recording by their numbers from show-recording, and/or keeps only the first keepFirst, saving it in place. The start and end screens follow the touches that remain. Removing a touch that moved to another screen leaves the touches after it recorded on a screen the replay won’t reach.',
                inputSchema: {
                    type: 'object',
                    properties: {
                        fileName: { type: 'string' },
                        remove: { type: 'array', items: { type: 'number' }, description: 'Touch numbers, from 1.' },
                        keepFirst: { type: 'number', description: 'Cut everything after this many touches, counted after removing.' },
                    },
                    required: ['fileName'],
                },
            },
            handler: async (args) => {
                const remove = Array.isArray(args.remove) ? args.remove.filter((value) => typeof value === 'number') : undefined;
                const keepFirst = typeof args.keepFirst === 'number' ? args.keepFirst : undefined;
                if (!remove?.length && keepFirst == null)
                    throw new Error('Pass remove, keepFirst or both');
                const fileName = String(args.fileName);
                const saved = await ops.editRecording(fileName, { remove, keepFirst });
                return { saved, touches: (await ops.readRecording(fileName)).events.map(describeTouch) };
            },
        },
        {
            tool: {
                name: 'play-recording',
                description: `Replays a saved recording, after ${START_DELAY_MS} ms, at its recorded pace unless gapMs or maxGapMs. A tap that tap-element sent finds its element again and taps where it is now. Before each touch it waits up to ${SCREEN_WAIT_MS / 1000} s for the screen that touch was recorded on; at the first that lands on another screen it stops, reporting diverged, unless keepGoing. misses lists touches that didn't go quite as recorded: an element it couldn't find, or another sub-tab of the right screen. Refuses to start on a screen other than the one the recording began on, unless force. LogBox toasts stay hidden while it plays. Waits up to ${CALL_BUDGET_MS / 1000} s for it to finish; a longer one keeps playing, so poll playback-status or call stop-playback.`,
                inputSchema: {
                    type: 'object',
                    properties: {
                        fileName: { type: 'string' },
                        wait: { type: 'boolean', description: 'False returns as soon as it starts.' },
                        force: { type: 'boolean', description: 'Start on whatever screen the app is on, and play every touch whatever screen it lands on.' },
                        keepGoing: { type: 'boolean', description: 'Play on past the first touch that lands on another screen.' },
                        gapMs: { type: 'number', description: 'Play every touch this long after the one before, instead of at its recorded time.' },
                        maxGapMs: { type: 'number', description: 'Keep the recorded gaps but shorten any longer than this.' },
                    },
                    required: ['fileName'],
                },
                destructive: true,
            },
            handler: async (args) => {
                const { finished } = await ops.play(String(args.fileName), {
                    force: args.force === true,
                    keepGoing: args.keepGoing === true,
                    ...(typeof args.gapMs === 'number' ? { gapMs: Math.max(0, args.gapMs) } : {}),
                    ...(typeof args.maxGapMs === 'number' ? { maxGapMs: Math.max(0, args.maxGapMs) } : {}),
                });
                if (args.wait === false)
                    finished.catch(() => undefined);
                const done = args.wait !== false && (await resolvesWithin(finished, CALL_BUDGET_MS));
                return { played: String(args.fileName), finished: done, playback: ops.state().playback };
            },
        },
        {
            tool: {
                name: 'playback-status',
                description: 'Which recording is playing and how far it has got (index of total touches); fileName is null once it has finished. diverged is the first touch that was about to land on another screen than it was recorded on (expected, actual, and whether the replay stopped there); misses are touches that didn’t go quite as recorded. Both stay until the next replay.',
                inputSchema: { type: 'object', properties: {} },
                readOnly: true,
            },
            handler: () => ops.state().playback,
        },
        {
            tool: {
                name: 'stop-playback',
                description: 'Stops the replay, if one is playing, and returns the playback state as playback-status does.',
                inputSchema: { type: 'object', properties: {} },
                idempotent: true,
            },
            handler: () => {
                ops.stopPlayback();
                return ops.state().playback;
            },
        },
    ];
    return tools.map(({ tool, handler }) => ({
        tool,
        handler: (args) => {
            quietLogBox.agentActive();
            return handler(args);
        },
    }));
}
