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
exports.TouchIndicator = void 0;
exports.showTouch = showTouch;
const jsx_runtime_1 = require("react/jsx-runtime");
const react_1 = __importStar(require("react"));
const react_native_1 = require("react-native");
const VISIBLE_MS = 450;
const SIZE = 28;
let marks = [];
let nextId = 0;
const listeners = new Set();
const notify = () => listeners.forEach((listener) => listener());
const subscribe = (listener) => {
    listeners.add(listener);
    return () => {
        listeners.delete(listener);
    };
};
/** Shows a dot where a synthetic touch landed, and with `to` another where its swipe ended. */
function showTouch(from, to) {
    nextId += 1;
    const id = nextId;
    marks = [...marks, { id, from, to }];
    notify();
    setTimeout(() => {
        marks = marks.filter((mark) => mark.id !== id);
        notify();
    }, VISIBLE_MS);
}
const dotAt = ({ x, y }) => ({ left: x - SIZE / 2, top: y - SIZE / 2 });
/** Draws the dots over the app; touches pass through it. Not over an RN `<Modal>`, which is a window of its own. */
exports.TouchIndicator = react_1.default.memo(function TouchIndicator() {
    const current = (0, react_1.useSyncExternalStore)(subscribe, () => marks);
    if (current.length === 0)
        return null;
    return ((0, jsx_runtime_1.jsx)(react_native_1.View, { pointerEvents: "none", style: react_native_1.StyleSheet.absoluteFill, children: current.map((mark) => ((0, jsx_runtime_1.jsxs)(react_1.default.Fragment, { children: [(0, jsx_runtime_1.jsx)(react_native_1.View, { style: [styles.dot, dotAt(mark.from)] }), mark.to && (0, jsx_runtime_1.jsx)(react_native_1.View, { style: [styles.dot, styles.end, dotAt(mark.to)] })] }, mark.id))) }));
});
const styles = react_native_1.StyleSheet.create({
    dot: {
        position: 'absolute',
        width: SIZE,
        height: SIZE,
        borderRadius: SIZE / 2,
        borderWidth: 2,
        borderColor: 'rgba(255, 45, 140, 0.95)',
        backgroundColor: 'rgba(255, 45, 140, 0.35)',
    },
    end: {
        backgroundColor: 'transparent',
    },
});
