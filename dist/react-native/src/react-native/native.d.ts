import type { ElementsSnapshot, Point } from '../shared/protocol';
export declare const isInputAvailable: () => boolean;
/** Synthetic input through the debug-only InputInjector native module. */
export declare const nativeInput: {
    tap: ({ x, y }: Point) => Promise<void>;
    swipe: (from: Point, to: Point, durationMs: number) => Promise<void>;
    elements: () => Promise<ElementsSnapshot>;
    /** The elements and every view as drawn. */
    elementsAndViews: () => Promise<ElementsSnapshot>;
    /** A hash of the views on screen. */
    fingerprint: () => Promise<string>;
    typeText: (text: string) => Promise<void>;
    longPress: (point: Point, durationMs: number) => Promise<void>;
    deleteBackward: (count: number) => Promise<void>;
};
