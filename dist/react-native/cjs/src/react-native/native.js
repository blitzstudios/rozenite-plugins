"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.nativeInput = exports.isInputAvailable = void 0;
const react_native_1 = require("react-native");
const native = react_native_1.NativeModules.InputInjector;
const isInputAvailable = () => !!native;
exports.isInputAvailable = isInputAvailable;
function injector() {
    if (!native)
        throw new Error('The InputInjector native module is missing: rebuild the app, as a debug build, after installing @sleeperhq/rozenite-plugin-input.');
    return native;
}
/** Synthetic input through the debug-only InputInjector native module. */
exports.nativeInput = {
    tap: async ({ x, y }) => {
        await injector().tap(x, y);
    },
    swipe: async (from, to, durationMs) => {
        await injector().swipe(from.x, from.y, to.x, to.y, durationMs);
    },
    elements: () => injector().elements(),
    /** The elements and every view as drawn. */
    elementsAndViews: () => injector().elementsAndViews(),
    /** A hash of the views on screen. */
    fingerprint: () => injector().fingerprint(),
    typeText: async (text) => {
        await injector().typeText(text);
    },
    longPress: async (point, durationMs) => {
        await injector().swipe(point.x, point.y, point.x, point.y, durationMs);
    },
    deleteBackward: async (count) => {
        await injector().deleteBackward(count);
    },
};
