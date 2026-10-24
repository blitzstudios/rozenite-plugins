import React, { useSyncExternalStore } from 'react';
import { StyleSheet, View } from 'react-native';
import type { Point } from '../shared/protocol';

const VISIBLE_MS = 450;
const SIZE = 28;

type Mark = { id: number; from: Point; to?: Point };

let marks: Mark[] = [];
let nextId = 0;
const listeners = new Set<() => void>();

const notify = () => listeners.forEach((listener) => listener());

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

/** Shows a dot where a synthetic touch landed, and with `to` another where its swipe ended. */
export function showTouch(from: Point, to?: Point): void {
  nextId += 1;
  const id = nextId;
  marks = [...marks, { id, from, to }];
  notify();
  setTimeout(() => {
    marks = marks.filter((mark) => mark.id !== id);
    notify();
  }, VISIBLE_MS);
}

const dotAt = ({ x, y }: Point) => ({ left: x - SIZE / 2, top: y - SIZE / 2 });

/** Draws the dots over the app; touches pass through it. Not over an RN `<Modal>`, which is a window of its own. */
export const TouchIndicator = React.memo(function TouchIndicator() {
  const current = useSyncExternalStore(subscribe, () => marks);
  if (current.length === 0) return null;
  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      {current.map((mark) => (
        <React.Fragment key={mark.id}>
          <View style={[styles.dot, dotAt(mark.from)]} />
          {mark.to && <View style={[styles.dot, styles.end, dotAt(mark.to)]} />}
        </React.Fragment>
      ))}
    </View>
  );
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
