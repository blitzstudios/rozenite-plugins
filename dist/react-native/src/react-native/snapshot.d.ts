import { type Frame, type Point, type ScreenElement, type TapTarget } from '../shared/protocol';
export type RefElement = {
    ref: string;
    element: ScreenElement;
};
export type SnapshotContext = {
    /** The screen the app is on, from the `currentScreen` option. */
    screen: string | null;
    appState: string;
    keyboard: boolean;
    size: Frame;
    scale: number;
};
/** What a tap on an element is recorded as aimed at, for replay to find it again. */
export declare const tapTargetOf: ({ testID, label }: ScreenElement) => TapTarget | undefined;
/** Whether an element's label is the one a recorded tap was aimed at. */
export declare const labelMatches: (label: string | undefined, target: string) => boolean;
export declare const describeTarget: ({ testID, label }: TapTarget) => string;
export declare const at: ({ x, y }: Point) => string;
/** Best first: one a tap reaches, then a button over its own text, then the topmost window. */
export declare const preferTappable: (a: ScreenElement, b: ScreenElement) => number;
/**
 * Short refs (`e12`) that stay with an element while it is on screen: the same test id, label and view
 * class, in the same order among its twins, keep the same ref from one snapshot to the next.
 */
export declare class RefTable {
    private refs;
    private byRef;
    private next;
    assign(elements: ScreenElement[]): RefElement[];
    /** The element a ref names in `elements`, or null when it has left the screen. */
    resolve(ref: string, elements: ScreenElement[]): ScreenElement | null;
    known(ref: string): boolean;
    private reset;
}
/**
 * Where a tap on an element should land. A card is aimed at its biggest piece of plain text that a tap reaches,
 * outside any button inside it, rather than its middle, where an image or video may open a viewer instead.
 */
export declare function aimPoint(element: ScreenElement, elements: ScreenElement[]): Point;
/**
 * Leaves out covered elements unless asked, and text whose words the view around it already has as its label; the
 * rest in reading order, window by window, since the view tree puts a header after the content under it.
 */
export declare function visible(entries: RefElement[], includeCovered: boolean): RefElement[];
export declare function line({ ref, element }: RefElement): string;
export declare function header(context: SnapshotContext, counts?: {
    shown: number;
    hidden: number;
    truncated?: boolean;
}): string[];
/** What changed between two snapshots, by ref: `+` appeared, `-` gone, `~` same element with a new value or traits. */
export declare function diff(before: RefElement[], after: RefElement[]): string[];
/** Identity and position of everything on screen, to tell when it has stopped moving. */
export declare const signature: (elements: ScreenElement[]) => string;
