import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import React, { useSyncExternalStore } from 'react';
import { StyleSheet, View } from 'react-native';
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
export function showTouch(from, to) {
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
export const TouchIndicator = React.memo(function TouchIndicator() {
    const current = useSyncExternalStore(subscribe, () => marks);
    if (current.length === 0)
        return null;
    return (_jsx(View, { pointerEvents: "none", style: StyleSheet.absoluteFill, children: current.map((mark) => (_jsxs(React.Fragment, { children: [_jsx(View, { style: [styles.dot, dotAt(mark.from)] }), mark.to && _jsx(View, { style: [styles.dot, styles.end, dotAt(mark.to)] })] }, mark.id))) }));
});
const styles = StyleSheet.create({
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
