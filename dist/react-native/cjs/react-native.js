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
var __exportStar = (this && this.__exportStar) || function(m, exports) {
    for (var p in m) if (p !== "default" && !Object.prototype.hasOwnProperty.call(exports, p)) __createBinding(exports, m, p);
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.fileRecordingStorage = exports.subscribeToCapturedTouches = exports.InputTouchCapture = exports.InputDevTools = void 0;
const react_1 = require("react");
const react_native_1 = require("react-native");
__exportStar(require("./src/shared/protocol"), exports);
// Constant in a release build, where Metro folds the condition and drops the `require`s with everything behind them.
const isDev = process.env.NODE_ENV !== 'production';
const isWeb = typeof window !== 'undefined' && window.navigator.product !== 'ReactNative';
if (isDev && !isWeb) {
    exports.InputDevTools = require('./src/react-native/input_devtools').InputDevTools;
    ({ InputTouchCapture: exports.InputTouchCapture, subscribeToCapturedTouches: exports.subscribeToCapturedTouches } = require('./src/react-native/touch_capture'));
    exports.fileRecordingStorage = require('./src/react-native/storage').fileRecordingStorage;
}
else {
    exports.InputDevTools = (() => null);
    exports.InputTouchCapture = (props) => (0, react_1.createElement)(react_native_1.View, props);
    exports.subscribeToCapturedTouches = () => () => { };
    exports.fileRecordingStorage = () => ({ list: async () => [], read: async () => '', write: async () => { }, remove: async () => { } });
}
