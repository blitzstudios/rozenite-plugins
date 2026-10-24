import { NativeModules } from 'react-native';
import type { ElementsSnapshot, Point } from '../shared/protocol';

type InputInjectorModule = {
  tap: (x: number, y: number) => Promise<unknown>;
  swipe: (fromX: number, fromY: number, toX: number, toY: number, durationMs: number) => Promise<unknown>;
  elements: () => Promise<ElementsSnapshot>;
  elementsAndViews: () => Promise<ElementsSnapshot>;
  typeText: (text: string) => Promise<unknown>;
  deleteBackward: (count: number) => Promise<unknown>;
  fingerprint: () => Promise<string>;
};

const native: InputInjectorModule | undefined = NativeModules.InputInjector;

export const isInputAvailable = (): boolean => !!native;

function injector(): InputInjectorModule {
  if (!native) throw new Error('The InputInjector native module is missing: rebuild the app, as a debug build, after installing @sleeperhq/rozenite-plugin-input.');
  return native;
}

/** Synthetic input through the debug-only InputInjector native module. */
export const nativeInput = {
  tap: async ({ x, y }: Point) => {
    await injector().tap(x, y);
  },
  swipe: async (from: Point, to: Point, durationMs: number) => {
    await injector().swipe(from.x, from.y, to.x, to.y, durationMs);
  },
  elements: () => injector().elements(),
  /** The elements and every view as drawn. */
  elementsAndViews: () => injector().elementsAndViews(),
  /** A hash of the views on screen. */
  fingerprint: () => injector().fingerprint(),
  typeText: async (text: string) => {
    await injector().typeText(text);
  },
  longPress: async (point: Point, durationMs: number) => {
    await injector().swipe(point.x, point.y, point.x, point.y, durationMs);
  },
  deleteBackward: async (count: number) => {
    await injector().deleteBackward(count);
  },
};
