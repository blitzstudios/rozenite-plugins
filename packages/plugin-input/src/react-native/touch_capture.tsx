import React from 'react';
import { View, type GestureResponderEvent, type ViewProps } from 'react-native';
import type { FingerTouch } from './config';

const listeners = new Set<(touch: FingerTouch) => void>();

const emit = (phase: FingerTouch['phase'], event: GestureResponderEvent) => {
  const { pageX, pageY, touches } = event.nativeEvent;
  const touch: FingerTouch = { phase, point: { x: pageX, y: pageY }, touches: touches?.length ?? 1 };
  listeners.forEach((listener) => listener(touch));
};

/** The finger touches `InputTouchCapture` sees, for `InputDevTools`' `subscribeToTouches`. */
export function subscribeToCapturedTouches(listener: (touch: FingerTouch) => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * A view for the app's root that passes every finger touch inside it to `subscribeToCapturedTouches`, without
 * taking part in handling it. Touches inside an RN `<Modal>` happen in another root and aren't seen.
 */
export function InputTouchCapture(props: ViewProps) {
  return (
    <View
      {...props}
      onTouchStart={(event) => {
        emit('start', event);
        props.onTouchStart?.(event);
      }}
      onTouchEnd={(event) => {
        emit('end', event);
        props.onTouchEnd?.(event);
      }}
      onTouchCancel={(event) => {
        emit('end', event);
        props.onTouchCancel?.(event);
      }}
    />
  );
}
