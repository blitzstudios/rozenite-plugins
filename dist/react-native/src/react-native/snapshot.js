import { isTextField } from '../shared/protocol';
const MAX_REFS = 5000;
const LABEL_MAX = 80;
const VALUE_MAX = 60;
const DIFF_MAX = 25;
/** A label joined from this many of a view's texts is a card's, whose counts, scores and timers change as it plays. */
const COMPOSITE_PARTS = 3;
/** A button this tall is a card, whose middle is often an image or video that takes a tap itself. */
const CARD_MIN_HEIGHT = 80;
const isComposite = (label) => label.split(', ').length >= COMPOSITE_PARTS;
const stableLabel = (label) => (isComposite(label) ? label.replace(/\d+/g, '#') : label);
/** A card's label joins all its text, scores and counts included, so only its first part stays the same. */
const targetLabel = (label) => (isComposite(label) ? label.split(', ')[0] : label);
/** What a tap on an element is recorded as aimed at, for replay to find it again. */
export const tapTargetOf = ({ testID, label }) => testID ? { testID } : label ? { label: targetLabel(label) } : undefined;
/** Whether an element's label is the one a recorded tap was aimed at. */
export const labelMatches = (label, target) => !!label && (label === target || targetLabel(label) === target);
export const describeTarget = ({ testID, label }) => (testID ? `#${testID}` : JSON.stringify(label));
export const at = ({ x, y }) => `${Math.round(x)},${Math.round(y)}`;
/** Best first: one a tap reaches, then a button over its own text, then the topmost window. */
export const preferTappable = (a, b) => Number(a.hittable === false) - Number(b.hittable === false) ||
    Number(!a.traits.includes('button')) - Number(!b.traits.includes('button')) ||
    b.window - a.window;
/**
 * What an element is, across snapshots. One with no test id or label has only its class to go on, which every
 * unlabeled button shares, so its position is part of it: its ref goes stale when it moves rather than passing to
 * another element. A card's numbers aren't part of it, so it keeps its ref while a timer on it counts.
 */
const keyOf = (element) => element.testID || element.label
    ? `${element.type}|${element.testID ?? ''}|${element.label ? stableLabel(element.label) : ''}`
    : `${element.type}@${Math.round(element.center.x / 4)},${Math.round(element.center.y / 4)}`;
const clip = (text, max) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);
const contains = (frame, x, y) => x >= frame.x && x <= frame.x + frame.width && y >= frame.y && y <= frame.y + frame.height;
/**
 * Short refs (`e12`) that stay with an element while it is on screen: the same test id, label and view
 * class, in the same order among its twins, keep the same ref from one snapshot to the next.
 */
export class RefTable {
    refs = new Map();
    byRef = new Map();
    next = 1;
    assign(elements) {
        const seen = new Map();
        return elements.map((element) => {
            const key = keyOf(element);
            const occurrence = seen.get(key) ?? 0;
            seen.set(key, occurrence + 1);
            const id = `${key}#${occurrence}`;
            let ref = this.refs.get(id);
            if (!ref) {
                if (this.refs.size >= MAX_REFS)
                    this.reset();
                ref = `e${this.next++}`;
                this.refs.set(id, ref);
                this.byRef.set(ref, { key, occurrence });
            }
            return { ref, element };
        });
    }
    /** The element a ref names in `elements`, or null when it has left the screen. */
    resolve(ref, elements) {
        const entry = this.byRef.get(ref);
        if (!entry)
            return null;
        return elements.filter((element) => keyOf(element) === entry.key)[entry.occurrence] ?? null;
    }
    known(ref) {
        return this.byRef.has(ref);
    }
    reset() {
        this.refs.clear();
        this.byRef.clear();
    }
}
const isPlainText = (element) => element.traits.length > 0 && element.traits.every((trait) => trait === 'text');
const within = (inner, outer) => inner.x >= outer.x - 1 &&
    inner.y >= outer.y - 1 &&
    inner.x + inner.width <= outer.x + outer.width + 1 &&
    inner.y + inner.height <= outer.y + outer.height + 1;
/**
 * Where a tap on an element should land. A card is aimed at its biggest piece of plain text that a tap reaches,
 * outside any button inside it, rather than its middle, where an image or video may open a viewer instead.
 */
export function aimPoint(element, elements) {
    if (element.frame.height < CARD_MIN_HEIGHT || !element.traits.includes('button'))
        return element.center;
    const inner = elements.filter((other) => other !== element && other.window === element.window && within(other.frame, element.frame));
    const buttons = inner.filter((other) => other.traits.includes('button') || other.traits.includes('link'));
    const texts = inner.filter((other) => isPlainText(other) && other.hittable !== false && !buttons.some((button) => contains(button.frame, other.center.x, other.center.y)));
    const area = (frame) => frame.width * frame.height;
    const biggest = texts.sort((a, b) => area(b.frame) - area(a.frame))[0];
    return biggest ? biggest.center : element.center;
}
const readingOrder = (a, b) => a.element.window - b.element.window || Math.round(a.element.center.y) - Math.round(b.element.center.y) || a.element.center.x - b.element.center.x;
/**
 * Leaves out covered elements unless asked, and text whose words the view around it already has as its label; the
 * rest in reading order, window by window, since the view tree puts a header after the content under it.
 */
export function visible(entries, includeCovered) {
    const shown = includeCovered ? entries : entries.filter(({ element }) => element.hittable !== false);
    const kept = shown.filter(({ element }) => {
        if (!element.label || element.testID || !isPlainText(element))
            return true;
        const label = element.label.toLowerCase();
        return !shown.some(({ element: other }) => other !== element && !isPlainText(other) && !!other.label?.toLowerCase().includes(label) && contains(other.frame, element.center.x, element.center.y));
    });
    return kept.sort(readingOrder);
}
export function line({ ref, element }) {
    const kind = isTextField(element)
        ? ['field', ...element.traits.filter((trait) => trait !== 'editable')]
        : element.traits.filter((trait) => trait !== 'text' || element.traits.length === 1);
    const parts = [ref];
    if (kind.length)
        parts.push(kind.join(','));
    if (!element.label && !element.testID)
        parts.push('unlabeled');
    if (element.label)
        parts.push(JSON.stringify(clip(element.label, LABEL_MAX)));
    if (element.testID)
        parts.push(`#${element.testID}`);
    if (element.value)
        parts.push(`=${JSON.stringify(clip(element.value, VALUE_MAX))}`);
    parts.push(`@${at(element.center)}`, `${Math.round(element.frame.width)}x${Math.round(element.frame.height)}`);
    if (element.window > 0)
        parts.push(`w${element.window}`);
    if (element.hittable === false)
        parts.push('covered');
    return parts.join(' ');
}
export function header(context, counts) {
    const parts = [context.screen ? `screen ${context.screen}` : 'screen not reported until the first navigation', context.appState];
    if (context.keyboard)
        parts.push('keyboard up');
    parts.push(`${Math.round(context.size.width)}x${Math.round(context.size.height)}pt @${context.scale}x`);
    if (counts)
        parts.push(`${counts.shown} shown${counts.hidden ? `, ${counts.hidden} covered or repeated hidden` : ''}${counts.truncated ? ', truncated' : ''}`);
    const lines = [parts.join(' · ')];
    if (context.appState !== 'active') {
        lines.push(`! The app is ${context.appState}: a system alert or prompt is probably over it. Take a screenshot to see it; only the user can answer it.`);
    }
    return lines;
}
/** What changed between two snapshots, by ref: `+` appeared, `-` gone, `~` same element with a new value or traits. */
export function diff(before, after) {
    const old = new Map(before.map((entry) => [entry.ref, entry.element]));
    const now = new Set(after.map((entry) => entry.ref));
    const appeared = [];
    const changed = [];
    after.forEach((entry) => {
        const previous = old.get(entry.ref);
        if (!previous)
            appeared.push(`+ ${line(entry)}`);
        else if (previous.value !== entry.element.value || previous.traits.join() !== entry.element.traits.join())
            changed.push(`~ ${line(entry)}`);
    });
    const gone = before.filter((entry) => !now.has(entry.ref)).map((entry) => `- ${line(entry)}`);
    const capped = (lines) => (lines.length > DIFF_MAX ? [...lines.slice(0, DIFF_MAX), `  … ${lines.length - DIFF_MAX} more`] : lines);
    const lines = [...capped(appeared), ...capped(gone), ...capped(changed)];
    return lines.length ? lines : ['no change on screen'];
}
/** Identity and position of everything on screen, to tell when it has stopped moving. */
export const signature = (elements) => elements.map((element) => `${keyOf(element)}@${at(element.center)}=${element.value ?? ''}`).join('\n');
