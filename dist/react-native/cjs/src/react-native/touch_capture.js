"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.subscribeToCapturedTouches = subscribeToCapturedTouches;
exports.InputTouchCapture = InputTouchCapture;
const jsx_runtime_1 = require("react/jsx-runtime");
const react_native_1 = require("react-native");
const listeners = new Set();
const emit = (phase, event) => {
    const { pageX, pageY, touches } = event.nativeEvent;
    const touch = { phase, point: { x: pageX, y: pageY }, touches: touches?.length ?? 1 };
    listeners.forEach((listener) => listener(touch));
};
/** The finger touches `InputTouchCapture` sees, for `InputDevTools`' `subscribeToTouches`. */
function subscribeToCapturedTouches(listener) {
    listeners.add(listener);
    return () => {
        listeners.delete(listener);
    };
}
/**
 * A view for the app's root that passes every finger touch inside it to `subscribeToCapturedTouches`, without
 * taking part in handling it. Touches inside an RN `<Modal>` happen in another root and aren't seen.
 */
function InputTouchCapture(props) {
    return ((0, jsx_runtime_1.jsx)(react_native_1.View, { ...props, onTouchStart: (event) => {
            emit('start', event);
            props.onTouchStart?.(event);
        }, onTouchEnd: (event) => {
            emit('end', event);
            props.onTouchEnd?.(event);
        }, onTouchCancel: (event) => {
            emit('end', event);
            props.onTouchCancel?.(event);
        } }));
}
