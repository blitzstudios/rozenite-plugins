import { createElement } from 'react';
import { View } from 'react-native';

export * from './src/shared/protocol';
export type { FingerTouch, InputOptions, RecordingStorage } from './src/react-native/config';
export type { RecordingFileSystem } from './src/react-native/storage';

// `typeof import` keeps each module in the build; the `require`s below load them only in a debug build.
export let InputDevTools: typeof import('./src/react-native/input_devtools').InputDevTools;
export let InputTouchCapture: typeof import('./src/react-native/touch_capture').InputTouchCapture;
export let subscribeToCapturedTouches: typeof import('./src/react-native/touch_capture').subscribeToCapturedTouches;
export let fileRecordingStorage: typeof import('./src/react-native/storage').fileRecordingStorage;

declare const require: (id: string) => any;
declare const process: { env: { NODE_ENV?: string } };

// Constant in a release build, where Metro folds the condition and drops the `require`s with everything behind them.
const isDev = process.env.NODE_ENV !== 'production';
const isWeb = typeof window !== 'undefined' && window.navigator.product !== 'ReactNative';

if (isDev && !isWeb) {
  InputDevTools = require('./src/react-native/input_devtools').InputDevTools;
  ({ InputTouchCapture, subscribeToCapturedTouches } = require('./src/react-native/touch_capture'));
  fileRecordingStorage = require('./src/react-native/storage').fileRecordingStorage;
} else {
  InputDevTools = (() => null) as unknown as typeof InputDevTools;
  InputTouchCapture = (props) => createElement(View, props);
  subscribeToCapturedTouches = () => () => {};
  fileRecordingStorage = () => ({ list: async () => [], read: async () => '', write: async () => {}, remove: async () => {} });
}
