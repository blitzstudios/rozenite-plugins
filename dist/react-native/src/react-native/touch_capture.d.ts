import { type ViewProps } from 'react-native';
import type { FingerTouch } from './config';
/** The finger touches `InputTouchCapture` sees, for `InputDevTools`' `subscribeToTouches`. */
export declare function subscribeToCapturedTouches(listener: (touch: FingerTouch) => void): () => void;
/**
 * A view for the app's root that passes every finger touch inside it to `subscribeToCapturedTouches`, without
 * taking part in handling it. Touches inside an RN `<Modal>` happen in another root and aren't seen.
 */
export declare function InputTouchCapture(props: ViewProps): import("react/jsx-runtime").JSX.Element;
