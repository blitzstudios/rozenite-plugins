"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.startInputBridge = startInputBridge;
const plugin_bridge_1 = require("@rozenite/plugin-bridge");
const protocol_1 = require("../shared/protocol");
const native_1 = require("./native");
const quiet_logbox_1 = require("./quiet_logbox");
const react_commits_1 = require("./react_commits");
const tap_player_1 = require("./tap_player");
const tap_recorder_1 = require("./tap_recorder");
const recordingStore = __importStar(require("./tap_recordings_store"));
const touch_indicator_1 = require("./touch_indicator");
const snapshot_1 = require("./snapshot");
const react_native_1 = require("@sleeperhq/rozenite-panel-kit/react-native");
/** How many inputs the log keeps. */
const INPUT_LOG_LIMIT = 50;
/** How long state changes gather before they go to the panels together. */
const FLUSH_MS = 100;
/** How long a replayed tap looks for its element, which may still be animating in, before using the recorded point. */
const TARGET_WAIT_MS = 3000;
const TARGET_POLL_MS = 150;
const sleep = (ms) => new Promise((resolve) => {
    setTimeout(resolve, ms);
});
/** The element a replayed tap was aimed at: the reachable match tap-element would prefer, then the nearest. */
function pickTarget(elements, target, near) {
    const { testID, label } = target;
    const matches = elements.filter((element) => element.hittable !== false && (testID ? element.testID === testID : !!label && (0, snapshot_1.labelMatches)(element.label, label)));
    const distance = (element) => Math.hypot(element.center.x - near.x, element.center.y - near.y);
    return matches.sort((a, b) => (0, snapshot_1.preferTappable)(a, b) || distance(a) - distance(b))[0] ?? null;
}
const randomId = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
/** Changes whenever the screen does, or null when React's commits can't be counted. */
async function screenStamp() {
    const commits = (0, react_commits_1.reactCommitCount)();
    return commits === null ? null : `${await native_1.nativeInput.fingerprint()}.${commits}`;
}
const viewsPart = (stamp) => stamp.split('.')[0];
const round = (point) => ({ x: Math.round(point.x), y: Math.round(point.y) });
/** Answers the Input panel and, while one is attached, pushes the log, the recorder and playback as they change. */
function startInputBridge(client) {
    const rpc = (0, plugin_bridge_1.createRozeniteRpc)(client);
    const sessionId = randomId();
    const log = [];
    let logId = 0;
    let saved = [];
    let timer = null;
    const state = () => ({
        sessionId,
        available: (0, native_1.isInputAvailable)(),
        recording: { active: tap_recorder_1.tapRecorder.isRecording(), count: tap_recorder_1.tapRecorder.count() },
        playback: tap_player_1.tapPlayer.getState(),
        recordings: saved,
        log: [...log],
    });
    const leases = (0, react_native_1.createPanelLeases)((attached) => {
        if (!attached && timer) {
            clearTimeout(timer);
            timer = null;
        }
    });
    const changed = () => {
        if (!leases.attached())
            return;
        timer ??= setTimeout(() => {
            timer = null;
            client.send('input:state', state());
        }, FLUSH_MS);
    };
    const refreshRecordings = async () => {
        saved = await recordingStore.listRecordings().catch(() => saved);
        changed();
        return saved;
    };
    /** Runs one input and logs it, failed or not. */
    const logged = async (source, kind, detail, run) => {
        logId += 1;
        const entry = { id: logId, at: Date.now(), source, kind, detail };
        log.push(entry);
        if (log.length > INPUT_LOG_LIMIT)
            log.shift();
        try {
            await run();
        }
        catch (error) {
            entry.error = error instanceof Error ? error.message : String(error);
            throw error;
        }
        finally {
            changed();
        }
    };
    const aimedAt = (point, target) => (target ? `${(0, snapshot_1.describeTarget)(target)} ${(0, snapshot_1.at)(point)}` : (0, snapshot_1.at)(point));
    const operations = {
        state,
        elements: (options) => (options?.views ? native_1.nativeInput.elementsAndViews() : native_1.nativeInput.elements()),
        tap: (point, source, target, options) => logged(source, 'tap', aimedAt(point, target), () => tap_recorder_1.tapRecorder.send({ ...round(point), ...(target ? { target } : {}) }, async () => {
            (0, touch_indicator_1.showTouch)(point);
            await native_1.nativeInput.tap(round(point));
        }, options)),
        longPress: (point, durationMs, source, target, options) => logged(source, 'long press', `${aimedAt(point, target)} for ${Math.round(durationMs)}ms`, () => tap_recorder_1.tapRecorder.send({ ...round(point), to: round(point), durationMs, ...(target ? { target } : {}) }, async () => {
            (0, touch_indicator_1.showTouch)(point);
            await native_1.nativeInput.longPress(round(point), durationMs);
        }, options)),
        swipe: ({ from, to, durationMs = protocol_1.DEFAULT_SWIPE_MS }, source, options) => logged(source, 'swipe', `${(0, snapshot_1.at)(from)} → ${(0, snapshot_1.at)(to)} in ${Math.round(durationMs)}ms`, () => tap_recorder_1.tapRecorder.send({ ...round(from), to: round(to), durationMs }, async () => {
            (0, touch_indicator_1.showTouch)(from, to);
            await native_1.nativeInput.swipe(round(from), round(to), durationMs);
        }, options)),
        typeText: (text, source) => logged(source, 'type', text === '\n' ? 'return' : JSON.stringify(text.length > 40 ? `${text.slice(0, 40)}…` : text), () => native_1.nativeInput.typeText(text)),
        deleteBackward: (count, source) => logged(source, 'delete', `×${count}`, () => native_1.nativeInput.deleteBackward(count)),
        startRecording: () => tap_recorder_1.tapRecorder.start(),
        stopRecording: async (name) => {
            const summary = await tap_recorder_1.tapRecorder.stop(name);
            await refreshRecordings();
            return summary;
        },
        play: (fileName, options) => tap_player_1.tapPlayer.play(fileName, async (event, cancelled) => {
            const hold = (0, protocol_1.isHold)(event);
            if (event.to && !hold)
                return operations.swipe({ from: event, to: event.to, durationMs: event.durationMs }, 'replay');
            const press = (point, target) => hold ? operations.longPress(point, event.durationMs ?? protocol_1.DEFAULT_LONG_PRESS_MS, 'replay', target) : operations.tap(point, 'replay', target);
            if (!event.target)
                return press(event);
            const deadline = Date.now() + TARGET_WAIT_MS;
            for (;;) {
                // eslint-disable-next-line no-await-in-loop
                const { elements } = await native_1.nativeInput.elements();
                if (cancelled())
                    return undefined;
                const found = pickTarget(elements, event.target, event);
                if (found)
                    return press((0, snapshot_1.aimPoint)(found, elements), event.target);
                if (Date.now() >= deadline)
                    break;
                // eslint-disable-next-line no-await-in-loop
                await sleep(TARGET_POLL_MS);
            }
            await press(event, event.target);
            return `${(0, snapshot_1.describeTarget)(event.target)} not found; pressed its recorded point`;
        }, options),
        stopPlayback: () => tap_player_1.tapPlayer.stop(),
        recordings: refreshRecordings,
        readRecording: (fileName) => recordingStore.readRecording(fileName),
        editRecording: async (fileName, edit) => {
            const summary = await recordingStore.editRecording(fileName, edit);
            await refreshRecordings();
            return summary;
        },
    };
    const unsubscribe = [tap_recorder_1.tapRecorder.subscribe(changed), tap_player_1.tapPlayer.subscribe(changed)];
    const subscriptions = [
        rpc.handle('attach', async ({ panelId }) => {
            if (leases.renew(panelId))
                await refreshRecordings();
            return state();
        }),
        rpc.handle('detach', async ({ panelId }) => leases.release(panelId)),
        rpc.handle('screen', async ({ since, ignoreText }) => {
            const stamp = await screenStamp();
            if (stamp && stamp === since)
                return { stamp };
            // Kept at `since`, so the text change is still news to the next check that doesn't ignore it.
            if (stamp && since && ignoreText && viewsPart(stamp) === viewsPart(since))
                return { stamp: since };
            return { stamp: stamp ?? randomId(), snapshot: await operations.elements({ views: true }) };
        }),
        rpc.handle('tap', (point) => operations.tap(point, 'panel')),
        rpc.handle('swipe', (params) => operations.swipe(params, 'panel')),
        rpc.handle('typeText', ({ text }) => operations.typeText(text, 'panel')),
        rpc.handle('deleteBackward', ({ count }) => operations.deleteBackward(Math.max(1, Math.round(count ?? 1)), 'panel')),
        rpc.handle('longPress', ({ x, y, durationMs }) => operations.longPress({ x, y }, Math.max(100, Math.min(10000, durationMs ?? protocol_1.DEFAULT_LONG_PRESS_MS)), 'panel')),
        rpc.handle('startRecording', async () => operations.startRecording()),
        rpc.handle('stopRecording', ({ name }) => operations.stopRecording(name)),
        rpc.handle('readRecording', ({ fileName }) => operations.readRecording(fileName)),
        rpc.handle('editRecording', ({ fileName, ...edit }) => operations.editRecording(fileName, edit)),
        rpc.handle('play', async ({ fileName, ...options }) => {
            const { finished } = await operations.play(fileName, options);
            finished.catch(() => undefined);
        }),
        rpc.handle('stopPlayback', async () => operations.stopPlayback()),
        rpc.handle('renameRecording', async ({ fileName, name }) => {
            await recordingStore.renameRecording(fileName, name);
            await refreshRecordings();
        }),
        rpc.handle('deleteRecording', async ({ fileName }) => {
            await recordingStore.deleteRecording(fileName);
            await refreshRecordings();
        }),
        rpc.handle('exportRecording', async ({ fileName }) => ({ json: JSON.stringify(await recordingStore.readRecording(fileName), null, 2) })),
        rpc.handle('importRecording', async ({ json }) => {
            const summary = await recordingStore.importRecording(json);
            await refreshRecordings();
            return summary;
        }),
    ];
    return {
        operations,
        stop: () => {
            if (timer)
                clearTimeout(timer);
            leases.releaseAll();
            unsubscribe.forEach((stop) => stop());
            quiet_logbox_1.quietLogBox.agentInactive();
            subscriptions.forEach((subscription) => subscription.remove());
            rpc.close();
        },
    };
}
