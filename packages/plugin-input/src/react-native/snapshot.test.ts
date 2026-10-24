import type { ScreenElement } from '../shared/protocol';
import { aimPoint, diff, header, labelMatches, line, preferTappable, RefTable, tapTargetOf, visible } from './snapshot';

const element = (overrides: Partial<ScreenElement> = {}): ScreenElement => ({
  traits: [],
  frame: { x: 0, y: 0, width: 100, height: 40 },
  center: { x: 50, y: 20 },
  window: 0,
  type: 'RCTViewComponentView',
  ...overrides,
});

const context = { screen: 'Login', appState: 'active', keyboard: false, size: { x: 0, y: 0, width: 402, height: 874 }, scale: 3 };

describe('RefTable', () => {
  it('keeps an element’s ref from one snapshot to the next', () => {
    const refs = new RefTable();
    const login = element({ label: 'LOG IN', traits: ['button'] });
    const first = refs.assign([element({ label: 'GET STARTED' }), login]);
    const second = refs.assign([login, element({ label: 'SIGN UP' })]);
    expect(second[0].ref).toBe(first[1].ref);
    expect(second[1].ref).not.toBe(first[0].ref);
  });

  it('tells twins apart by their order', () => {
    const refs = new RefTable();
    const [a, b] = refs.assign([element({ label: 'Row' }), element({ label: 'Row', center: { x: 50, y: 80 } })]);
    expect(a.ref).not.toBe(b.ref);
    const moved = [element({ label: 'Row', center: { x: 50, y: 30 } }), element({ label: 'Row', center: { x: 50, y: 90 } })];
    expect(refs.resolve(b.ref, moved)?.center.y).toBe(90);
  });

  it('does not pass an unlabeled element’s ref to another unlabeled element', () => {
    const refs = new RefTable();
    const [back] = refs.assign([element({ center: { x: 24, y: 90 } })]);
    const afterNavigating = [element({ center: { x: 200, y: 400 } })];
    expect(refs.resolve(back.ref, afterNavigating)).toBeNull();
    expect(refs.assign(afterNavigating)[0].ref).not.toBe(back.ref);
    expect(refs.resolve(back.ref, [element({ center: { x: 25, y: 91 } })])).not.toBeNull();
  });

  it('resolves to null once the element has gone', () => {
    const refs = new RefTable();
    const [entry] = refs.assign([element({ label: 'LOG IN' })]);
    expect(refs.resolve(entry.ref, [element({ label: 'SIGN UP' })])).toBeNull();
    expect(refs.known(entry.ref)).toBe(true);
    expect(refs.known('e999')).toBe(false);
  });

  it('keeps a card’s ref while the numbers on it change', () => {
    const refs = new RefTable();
    const [card] = refs.assign([element({ label: 'Nick, 2h, Big win tonight, 0:12, 4 likes', traits: ['button'] })]);
    expect(refs.resolve(card.ref, [element({ label: 'Nick, 2h, Big win tonight, 0:13, 5 likes', traits: ['button'] })])).not.toBeNull();
    const [score] = refs.assign([element({ label: 'Week 7' })]);
    expect(refs.resolve(score.ref, [element({ label: 'Week 8' })])).toBeNull();
  });
});

describe('aimPoint', () => {
  const card = element({ label: 'Nick, Big win tonight', traits: ['button'], frame: { x: 0, y: 100, width: 400, height: 300 }, center: { x: 200, y: 250 } });
  const text = (label: string, frame: { x: number; y: number; width: number; height: number }, overrides: Partial<ScreenElement> = {}) =>
    element({ label, traits: ['text'], frame, center: { x: frame.x + frame.width / 2, y: frame.y + frame.height / 2 }, ...overrides });

  it('aims a card at its biggest text', () => {
    const body = text('Big win tonight', { x: 10, y: 140, width: 380, height: 40 });
    expect(aimPoint(card, [card, text('Nick', { x: 10, y: 110, width: 40, height: 20 }), body])).toEqual(body.center);
  });

  it('skips text inside a button in the card, and text something covers', () => {
    const name = text('Nick', { x: 10, y: 110, width: 200, height: 20 });
    const profile = element({ label: 'Nick', traits: ['button'], frame: { x: 0, y: 105, width: 220, height: 30 }, center: { x: 110, y: 120 } });
    const covered = text('Big win tonight', { x: 10, y: 140, width: 380, height: 40 }, { hittable: false });
    const caption = text('tonight', { x: 10, y: 380, width: 60, height: 15 });
    expect(aimPoint(card, [card, name, profile, covered, caption])).toEqual(caption.center);
  });

  it('leaves short buttons and cards with no text at their center', () => {
    const chip = element({ label: 'Popular', traits: ['button'], frame: { x: 0, y: 0, width: 60, height: 30 }, center: { x: 30, y: 15 } });
    expect(aimPoint(chip, [chip, text('Popular', { x: 5, y: 5, width: 50, height: 20 })])).toEqual(chip.center);
    expect(aimPoint(card, [card])).toEqual(card.center);
  });
});

describe('tapTargetOf', () => {
  it('aims at a test id over a label', () => {
    expect(tapTargetOf(element({ testID: 'login', label: 'LOG IN' }))).toEqual({ testID: 'login' });
    expect(tapTargetOf(element())).toBeUndefined();
  });

  it('keeps only the first part of a card’s label', () => {
    expect(tapTargetOf(element({ label: 'Nick, 2h, Big win tonight, 4 likes' }))).toEqual({ label: 'Nick' });
    expect(tapTargetOf(element({ label: 'Week 7, Final' }))).toEqual({ label: 'Week 7, Final' });
  });
});

describe('labelMatches', () => {
  it('matches the whole label, or a card’s first part', () => {
    expect(labelMatches('Week 7, Final', 'Week 7, Final')).toBe(true);
    expect(labelMatches('Nick, 3h, Big win tonight, 5 likes', 'Nick')).toBe(true);
    expect(labelMatches('Week 7, Final', 'Week 7')).toBe(false);
    expect(labelMatches(undefined, 'Nick')).toBe(false);
  });
});

describe('preferTappable', () => {
  it('puts one a tap reaches first, then a button, then the topmost window', () => {
    const covered = element({ label: 'covered', traits: ['button'], window: 2, hittable: false });
    const text = element({ label: 'text', window: 2 });
    const button = element({ label: 'button', traits: ['button'] });
    const sheetButton = element({ label: 'sheet button', traits: ['button'], window: 1 });
    expect([covered, text, button, sheetButton].sort(preferTappable).map((entry) => entry.label)).toEqual(['sheet button', 'button', 'text', 'covered']);
  });
});

describe('visible', () => {
  it('drops covered elements unless asked for them', () => {
    const refs = new RefTable();
    const entries = refs.assign([element({ label: 'Under', hittable: false }), element({ label: 'Over' })]);
    expect(visible(entries, false).map((entry) => entry.element.label)).toEqual(['Over']);
    expect(visible(entries, true)).toHaveLength(2);
  });

  it('drops text the view around it already has in its label', () => {
    const refs = new RefTable();
    const entries = refs.assign([
      element({ label: '!, Open debugger to view warnings.' }),
      element({ label: '!', traits: ['text'], center: { x: 10, y: 20 } }),
      element({ label: 'Open debugger to view warnings.', traits: ['text'] }),
      element({ label: 'Elsewhere', traits: ['text'], center: { x: 300, y: 300 } }),
    ]);
    expect(visible(entries, false).map((entry) => entry.element.label)).toEqual(['!, Open debugger to view warnings.', 'Elsewhere']);
  });

  it('puts elements in reading order, window by window', () => {
    const refs = new RefTable();
    const entries = refs.assign([
      element({ label: 'Content', center: { x: 50, y: 400 } }),
      element({ label: 'Back', center: { x: 24, y: 90 } }),
      element({ label: 'Title', center: { x: 200, y: 90 } }),
      element({ label: 'Sheet', center: { x: 50, y: 10 }, window: 1 }),
    ]);
    expect(visible(entries, false).map((entry) => entry.element.label)).toEqual(['Back', 'Title', 'Content', 'Sheet']);
  });

  it('keeps text with a test id', () => {
    const refs = new RefTable();
    const entries = refs.assign([element({ label: 'Total' }), element({ label: 'Total', traits: ['text'], testID: 'total' })]);
    expect(visible(entries, false)).toHaveLength(2);
  });
});

describe('line', () => {
  it('writes an element on one line', () => {
    const field = element({
      testID: 'input-email',
      value: 'snap',
      type: 'RCTUITextField',
      center: { x: 201, y: 240.4 },
      frame: { x: 24, y: 221, width: 354, height: 38 },
    });
    expect(line({ ref: 'e11', element: field })).toBe('e11 field #input-email ="snap" @201,240 354x38');
    expect(line({ ref: 'e3', element: element({ label: 'LOG IN', traits: ['button', 'text'], window: 1, hittable: false }) })).toBe(
      'e3 button "LOG IN" @50,20 100x40 w1 covered',
    );
    expect(line({ ref: 'e9', element: element({ traits: ['button'], center: { x: 24, y: 90 }, frame: { x: 12, y: 74, width: 24, height: 32 } }) })).toBe(
      'e9 button unlabeled @24,90 24x32',
    );
  });
});

describe('header', () => {
  it('warns when the app is not active', () => {
    expect(header(context)).toEqual(['screen Login · active · 402x874pt @3x']);
    const inactive = header({ ...context, appState: 'inactive', keyboard: true });
    expect(inactive[0]).toBe('screen Login · inactive · keyboard up · 402x874pt @3x');
    expect(inactive[1]).toMatch(/system alert/);
  });
});

describe('diff', () => {
  it('lists what appeared, went and changed', () => {
    const refs = new RefTable();
    const before = refs.assign([element({ label: 'LOG IN' }), element({ testID: 'email', type: 'RCTUITextField' })]);
    const after = refs.assign([element({ testID: 'email', type: 'RCTUITextField', value: 'a' }), element({ label: 'NEXT', traits: ['button'] })]);
    expect(diff(before, after)).toEqual([
      `+ ${after[1].ref} button "NEXT" @50,20 100x40`,
      `- ${before[0].ref} "LOG IN" @50,20 100x40`,
      `~ ${after[0].ref} field #email ="a" @50,20 100x40`,
    ]);
  });

  it('says when nothing changed', () => {
    const refs = new RefTable();
    const entries = refs.assign([element({ label: 'LOG IN' })]);
    expect(diff(entries, entries)).toEqual(['no change on screen']);
  });
});
