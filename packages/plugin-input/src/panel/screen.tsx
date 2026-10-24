import { memo, useEffect, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent, type PointerEvent, type RefObject } from 'react';
import { Badge, Button, Column, EmptyState, Row, SearchField, Switch, Text, ToggleGroup } from '@rozenite/ui';
import { ValueStore, matches, useStore } from '@sleeperhq/rozenite-panel-kit';
import {
  DEFAULT_LONG_PRESS_MS,
  isTextField,
  type ElementsSnapshot,
  type Frame,
  type Point,
  type ScreenElement,
  type TextStyle,
  type ViewBox,
} from '../shared/protocol';
import { useConnection } from './connection';
import { useRun } from './run';

/** How often the panel asks whether the screen changed. */
const CHECK_MS = 500;
/** The least time between reads of a screen whose views keep moving, such as one with an animation. */
const MOVED_GAP_MS = 1000;
/** The least time between reads when only text changed, such as a clock ticking. */
const TEXT_GAP_MS = 3000;
/** How soon after an input the screen is checked. */
const AFTER_INPUT_MS = 300;
/** For this long after an input the screen is read at the quick pace however much it changes, to follow where the input led. */
const SETTLING_MS = 2500;
const FONT = '-apple-system, BlinkMacSystemFont, system-ui, sans-serif';
const LINE_HEIGHT = 1.2;
const MIN_FONT_PT = 4;
const MAX_FONT_PT = 40;
/** Text is laid out this much larger and scaled down, since small sizes round each glyph's width up and outgrow the measured fit. */
const LAYOUT_SCALE = 4;
/** One-line text is sized to this share of its frame's width, so a font running a little wider still fits. */
const FIT_SLACK = 0.97;

type DrawMode = 'wireframe' | 'render';

const elementsStore = new ValueStore<ElementsSnapshot | null>(null);
const liveStore = new ValueStore<boolean>(true, 'input-panel:live:v1');
const drawModeStore = new ValueStore<DrawMode>('wireframe', 'input-panel:screen-view:v1');
const hoveredStore = new ValueStore<ScreenElement | null>(null);
const watchersStore = new ValueStore<number>(0);

const nameOf = (element: ScreenElement) => element.label ?? element.testID ?? element.type;

const isText = (element: ScreenElement) => element.traits.includes('text') || /Paragraph|TextView/.test(element.type);

/** What to write inside an element: a field's contents, its label as a placeholder when empty, or a text view's text. */
function textOf(element: ScreenElement): { text: string; placeholder: boolean } | null {
  if (isTextField(element)) {
    if (element.value) return { text: element.value, placeholder: false };
    return element.label ? { text: element.label, placeholder: true } : null;
  }
  return isText(element) && element.label ? { text: element.label, placeholder: false } : null;
}

let measureContext: CanvasRenderingContext2D | null = null;
const unitWidths = new Map<string, number>();

/** How wide `text` is per point of font size. */
function unitWidth(text: string): number {
  const cached = unitWidths.get(text);
  if (cached !== undefined) return cached;
  measureContext ??= document.createElement('canvas').getContext('2d');
  if (!measureContext) return text.length * 0.55;
  measureContext.font = `100px ${FONT}`;
  const width = measureContext.measureText(text).width / 100;
  if (unitWidths.size > 5000) unitWidths.clear();
  unitWidths.set(text, width);
  return width;
}

/**
 * The font size that fills the frame, and whether the text wraps. The snapshot carries no font sizes, but a text
 * view's frame hugs its text, so its shape gives the line count: n lines of a w-wide frame hold n·w of text.
 */
function fitText(text: string, { width, height }: Frame): { size: number; wraps: boolean } {
  const perPoint = unitWidth(text);
  const size = Math.sqrt((width * height) / (LINE_HEIGHT * perPoint));
  if (height / (LINE_HEIGHT * size) < 1.5) {
    return { size: Math.max(MIN_FONT_PT, Math.min(MAX_FONT_PT, height / LINE_HEIGHT, (width * FIT_SLACK) / perPoint)), wraps: false };
  }
  return { size: Math.max(MIN_FONT_PT, Math.min(MAX_FONT_PT, size * 0.9)), wraps: true };
}

/**
 * The size to draw text at and whether it wraps: the app's size when known, shrunk to fit on one line when the
 * frame holds one line, since this browser's font may run wider than the app's.
 */
function sizeText(text: string, frame: Frame, appSize?: number): { size: number; wraps: boolean } {
  if (!appSize) return fitText(text, frame);
  if (frame.height >= appSize * LINE_HEIGHT * 1.5) return { size: appSize, wraps: true };
  return { size: Math.max(MIN_FONT_PT, Math.min(appSize, (frame.width * FIT_SLACK) / unitWidth(text))), wraps: false };
}

type TextBlockProps = {
  text: string;
  /** Where it shows: the part of the text view on screen. */
  frame: Frame;
  /** The whole text view, which the text is laid out in. */
  full: Frame;
  placeholder: boolean;
  style?: TextStyle;
  colored: boolean;
  faded: boolean;
};

function TextBlock({ text, frame, full, placeholder, style, colored, faded }: TextBlockProps) {
  const { size, wraps } = sizeText(text, full, style?.size);
  const tone = colored && style?.color ? '' : placeholder ? 'text-muted-foreground' : 'text-foreground';
  return (
    <foreignObject x={frame.x} y={frame.y} width={frame.width} height={frame.height} pointerEvents="none">
      <div
        className={`${tone} ${faded ? 'opacity-25' : ''}`}
        style={{
          position: 'relative',
          left: full.x - frame.x,
          top: full.y - frame.y,
          width: full.width * LAYOUT_SCALE,
          height: full.height * LAYOUT_SCALE,
          transform: `scale(${1 / LAYOUT_SCALE})`,
          transformOrigin: '0 0',
          fontFamily: FONT,
          fontSize: size * LAYOUT_SCALE,
          lineHeight: LINE_HEIGHT,
          overflow: 'hidden',
          ...(style?.weight ? { fontWeight: style.weight } : {}),
          ...(style?.italic ? { fontStyle: 'italic' } : {}),
          ...(style?.align ? { textAlign: style.align } : {}),
          ...(colored && style?.color ? { color: style.color } : {}),
          ...(wraps ? { overflowWrap: 'anywhere' } : { whiteSpace: 'nowrap' }),
        }}
      >
        {text}
      </div>
    </foreignObject>
  );
}

/** Text from the element list, for a build whose native module can't list views. */
function ElementText({ element }: { element: ScreenElement }) {
  const content = textOf(element);
  if (!content) return null;
  return <TextBlock {...content} frame={element.frame} full={element.frame} colored={false} faded={element.hittable === false} />;
}

const frameKey = ({ x, y, width, height }: Frame) => `${Math.round(x)},${Math.round(y)},${Math.round(width)},${Math.round(height)}`;

/**
 * One view: its outline in the wireframe, or its background and border as the app draws them, then its text. A
 * text view something is drawn over is faded in the wireframe; drawn in order, a render covers it as the app does.
 */
function ViewShape({ box, render, covered }: { box: ViewBox; render: boolean; covered: Set<string> }) {
  const { frame } = box;
  const full = box.full ?? frame;
  const radius = Math.min(box.radius ?? 0, frame.width / 2, frame.height / 2);
  const border = render ? box.border : undefined;
  const inset = border ? border.width / 2 : 0;
  const drawsBox = render ? !!box.background || !!border : true;
  return (
    <>
      {drawsBox && (
        <rect
          x={frame.x + inset}
          y={frame.y + inset}
          width={Math.max(0, frame.width - inset * 2)}
          height={Math.max(0, frame.height - inset * 2)}
          rx={radius}
          pointerEvents="none"
          fill={render ? box.background ?? 'none' : 'none'}
          {...(render ? (border ? { stroke: border.color, strokeWidth: border.width } : {}) : { className: 'stroke-muted-foreground/25', strokeWidth: 0.5 })}
        />
      )}
      {box.text && (
        <TextBlock
          text={box.text}
          frame={frame}
          full={full}
          placeholder={!!box.placeholder}
          style={box.style}
          colored={render}
          faded={!render && covered.has(frameKey(full))}
        />
      )}
    </>
  );
}

/**
 * Whether the panel can be seen: its window is showing, and no frame around it is hidden, as Rozenite hides the
 * frames of the plugins not picked. An IntersectionObserver counts a hidden frame as seen.
 */
function panelShowing(): boolean {
  if (document.hidden) return false;
  try {
    for (let frame = window.frameElement; frame; frame = frame.ownerDocument.defaultView?.frameElement ?? null) {
      if (frame.ownerDocument.defaultView?.getComputedStyle(frame).visibility === 'hidden') return false;
    }
  } catch {
    // A frame from another origin can't be looked into; take it as showing.
  }
  return true;
}

/** Counts the screen widgets showing, so the screen is only read while one is. */
function useWatchScreen(ref: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const node = ref.current;
    if (!node) return undefined;
    let shown = false;
    const show = (next: boolean) => {
      if (next === shown) return;
      shown = next;
      watchersStore.update((count) => count + (next ? 1 : -1));
    };
    const observer = new IntersectionObserver(([entry]) => show(!!entry?.isIntersecting));
    observer.observe(node);
    return () => {
      observer.disconnect();
      show(false);
    };
  }, [ref]);
}

/**
 * Keeps `elementsStore` current while a screen widget shows: on connect, after each input, and while live, by asking
 * the app every so often whether the screen changed. Mounted once, by the panel.
 */
export function useElementsRefresh() {
  const { state, connected, call } = useConnection();
  const live = useStore(liveStore);
  const watched = useStore(watchersStore) > 0;
  const lastInput = state?.log[state.log.length - 1]?.id;
  const available = !!state?.available;
  const sessionId = state?.sessionId;
  const stamp = useRef<string | undefined>(undefined);
  const inputAt = useRef(0);
  const readAt = useRef(0);

  useEffect(() => {
    stamp.current = undefined;
  }, [sessionId]);
  useEffect(() => {
    if (lastInput !== undefined) inputAt.current = Date.now();
  }, [lastInput]);

  useEffect(() => {
    if (!connected || !available || !watched) return undefined;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const check = async () => {
      const settling = Date.now() - inputAt.current < SETTLING_MS;
      const sinceRead = Date.now() - readAt.current;
      if (live && !settling && sinceRead < MOVED_GAP_MS) {
        timer = setTimeout(check, MOVED_GAP_MS - sinceRead);
        return;
      }
      if (panelShowing()) {
        try {
          const update = await call('screen', { since: stamp.current, ignoreText: !settling && sinceRead < TEXT_GAP_MS });
          if (cancelled) return;
          stamp.current = update.stamp;
          if (update.snapshot) {
            elementsStore.update(update.snapshot);
            readAt.current = Date.now();
          }
        } catch {
          // The next check asks again.
        }
      }
      if (!cancelled && live) timer = setTimeout(check, CHECK_MS);
    };
    timer = setTimeout(check, lastInput === undefined ? 0 : AFTER_INPUT_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [connected, available, call, live, lastInput, watched, sessionId]);
}

/** A press that moves less than this, in points, is a tap or a long press rather than a swipe. */
const SLOP_PT = 6;
/** Held this long without moving, a press is a long press. */
const HOLD_MS = 500;
const MAX_HOLD_MS = 10000;
const MIN_SWIPE_MS = 80;
const MAX_SWIPE_MS = 3000;
/** Keys typed this close together go to the app as one piece of text. */
const TYPE_BATCH_MS = 150;

type Press = { from: Point; to: Point; startedAt: number; moved: boolean; held: boolean };

/** Sends the screen's gestures and keystrokes to the app, in order, with a toast when one fails. */
function useScreenInput() {
  const { call } = useConnection();
  const run = useRun();
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  const pending = useRef({ text: '', backspaces: 0 });
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const send = (title: string, fn: () => Promise<unknown>) => {
    queue.current = queue.current.then(() => run(title, fn));
  };
  const flush = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    const { text, backspaces } = pending.current;
    pending.current = { text: '', backspaces: 0 };
    if (backspaces) send('Delete', () => call('deleteBackward', { count: backspaces }));
    if (text) send('Typing', () => call('typeText', { text }));
  };
  const flushRef = useRef(flush);
  flushRef.current = flush;
  useEffect(() => () => flushRef.current(), []);

  return {
    tap: (point: Point) => send('Tap', () => call('tap', point)),
    longPress: (point: Point, durationMs: number) => send('Long press', () => call('longPress', { ...point, durationMs })),
    swipe: (from: Point, to: Point, durationMs: number) => send('Swipe', () => call('swipe', { from, to, durationMs })),
    /** Answers whether the key was one the app takes. */
    key: (key: string): boolean => {
      if (key === 'Enter') {
        flush();
        send('Return', () => call('typeText', { text: '\n' }));
        return true;
      }
      if (key === 'Backspace') {
        if (pending.current.text) pending.current.text = pending.current.text.slice(0, -1);
        else pending.current.backspaces += 1;
      } else if (key.length === 1) {
        pending.current.text += key;
      } else {
        return false;
      }
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(flush, TYPE_BATCH_MS);
      return true;
    },
  };
}

/**
 * The screen drawn from its views, as a wireframe of every view's outline and text, or rendered in the app's
 * colors. A click taps the app there, a drag swipes, a hold long-presses, and once clicked, typing goes to the
 * app's focused field. The panel can't stream a touch, so each gesture goes to the app when the mouse comes up.
 */
export function ScreenWidget() {
  const rootRef = useRef<HTMLDivElement>(null);
  useWatchScreen(rootRef);
  const { state } = useConnection();
  const snapshot = useStore(elementsStore);
  return (
    <div ref={rootRef} className="h-full">
      {state && !state.available ? (
        <EmptyState title="This build can’t read the screen" />
      ) : snapshot ? (
        <ScreenView snapshot={snapshot} />
      ) : (
        <EmptyState title="Reading the screen…" />
      )}
    </div>
  );
}

/** The element a tap at `point` reaches, as far as frames tell: the smallest holding it, in the topmost window. */
function elementAt(elements: ScreenElement[], point: Point): ScreenElement | null {
  const area = ({ frame }: ScreenElement) => frame.width * frame.height;
  return elements.reduce<ScreenElement | null>((best, element) => {
    const { x, y, width, height } = element.frame;
    const holds = element.hittable !== false && point.x >= x && point.y >= y && point.x <= x + width && point.y <= y + height;
    if (!holds) return best;
    return !best || element.window > best.window || (element.window === best.window && area(element) < area(best)) ? element : best;
  }, null);
}

/** The screen as drawn, apart from what follows the mouse, so moving it doesn't redraw every view. */
const ScreenDrawing = memo(function ScreenDrawing({ snapshot, render }: { snapshot: ElementsSnapshot; render: boolean }) {
  const covered = useMemo(
    () => new Set(snapshot.elements.filter((element) => element.hittable === false).map((element) => frameKey(element.frame))),
    [snapshot],
  );
  const { screen, views } = snapshot;
  return (
    <svg
      className="pointer-events-none absolute inset-0 h-full w-full"
      style={{ willChange: 'transform' }}
      viewBox={`0 0 ${screen.width} ${screen.height}`}
      preserveAspectRatio="xMidYMid meet"
    >
      <rect x={0} y={0} width={screen.width} height={screen.height} rx={24} className="fill-muted stroke-border" strokeWidth={1} />
      {views?.map((box, index) => (
        <ViewShape key={index} box={box} render={render} covered={covered} />
      ))}
      {!render &&
        snapshot.elements.map((element, index) => {
          const button = element.traits.includes('button');
          if (views && !button) return null;
          return (
            <rect
              key={index}
              x={element.frame.x}
              y={element.frame.y}
              width={element.frame.width}
              height={element.frame.height}
              fill="none"
              className={button ? 'stroke-info/60' : 'stroke-muted-foreground/30'}
              strokeWidth={0.75}
            />
          );
        })}
      {!views && snapshot.elements.map((element, index) => <ElementText key={index} element={element} />)}
    </svg>
  );
});

function ScreenView({ snapshot }: { snapshot: ElementsSnapshot }) {
  const hovered = useStore(hoveredStore);
  const mode = useStore(drawModeStore);
  const input = useScreenInput();
  const svgRef = useRef<SVGSVGElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const [pointer, setPointer] = useState<Point | null>(null);
  const [press, setPress] = useState<Press | null>(null);
  const [typing, setTyping] = useState(false);
  const pressRef = useRef<Press | null>(null);
  const holdTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const updatePress = (next: Press | null) => {
    pressRef.current = next;
    setPress(next);
  };
  const under = useMemo(() => (pointer ? elementAt(snapshot.elements, pointer) : null), [snapshot, pointer]);

  const { screen, views } = snapshot;
  const render = mode === 'render' && !!views;
  const marked = hovered ?? (press ? null : under);

  const toApp = (event: MouseEvent<SVGSVGElement>): Point | null => {
    const svg = svgRef.current;
    const matrix = svg?.getScreenCTM();
    if (!svg || !matrix) return null;
    const point = new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix.inverse());
    return { x: Math.round(point.x), y: Math.round(point.y) };
  };

  const clearHold = () => {
    if (holdTimer.current) clearTimeout(holdTimer.current);
    holdTimer.current = null;
  };
  useEffect(
    () => () => {
      if (holdTimer.current) clearTimeout(holdTimer.current);
    },
    [],
  );
  const onPointerDown = (event: PointerEvent<SVGSVGElement>) => {
    if (event.button !== 0) return;
    const point = toApp(event);
    if (!point) return;
    event.preventDefault();
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // Capture keeps a drag that leaves the screen going; the press works without it.
    }
    boxRef.current?.focus();
    updatePress({ from: point, to: point, startedAt: Date.now(), moved: false, held: false });
    clearHold();
    holdTimer.current = setTimeout(() => {
      const current = pressRef.current;
      if (current && !current.moved) updatePress({ ...current, held: true });
    }, HOLD_MS);
  };
  const onPointerMove = (event: PointerEvent<SVGSVGElement>) => {
    const point = toApp(event);
    setPointer(point);
    const current = pressRef.current;
    if (!current || !point || current.held) return;
    const moved = current.moved || Math.hypot(point.x - current.from.x, point.y - current.from.y) > SLOP_PT;
    if (moved) clearHold();
    updatePress({ ...current, to: point, moved });
  };
  const onPointerUp = () => {
    const current = pressRef.current;
    clearHold();
    updatePress(null);
    if (!current) return;
    const elapsed = Date.now() - current.startedAt;
    if (current.held) input.longPress(current.from, Math.max(DEFAULT_LONG_PRESS_MS, Math.min(elapsed, MAX_HOLD_MS)));
    else if (current.moved) input.swipe(current.from, current.to, Math.max(MIN_SWIPE_MS, Math.min(elapsed, MAX_SWIPE_MS)));
    else input.tap(current.from);
  };
  const onPointerCancel = () => {
    clearHold();
    updatePress(null);
  };
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      boxRef.current?.blur();
      return;
    }
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    if (input.key(event.key)) event.preventDefault();
  };

  const hint = typing
    ? 'typing goes to the app’s focused field · Esc to stop'
    : `${screen.width} × ${screen.height} pt — click to tap · drag to swipe · hold to long-press · click, then type`;

  return (
    <Column fill className="h-full p-2" gap={1}>
      <Row gap={2} align="center" className="shrink-0">
        <ToggleGroup<DrawMode> size="sm" value={[render ? 'render' : 'wireframe']} onValueChange={(value) => value[0] && drawModeStore.update(value[0])}>
          <ToggleGroup.Item value="wireframe">Wireframe</ToggleGroup.Item>
          <ToggleGroup.Item value="render" disabled={!views} title={views ? undefined : 'Rebuild the app to read its views'}>
            Render
          </ToggleGroup.Item>
        </ToggleGroup>
        <Text variant="caption" tone="neutral" className="min-w-0 truncate">
          {press?.held
            ? `long press at (${press.from.x}, ${press.from.y}) — let go to send`
            : press?.moved
            ? `swipe (${press.from.x}, ${press.from.y}) → (${press.to.x}, ${press.to.y})`
            : pointer && !typing
            ? `(${pointer.x}, ${pointer.y})${under ? ` · ${nameOf(under)}` : ''}`
            : `${hint}${snapshot.viewsTruncated ? ' · too many views, some left out' : ''}`}
        </Text>
      </Row>
      <div
        ref={boxRef}
        tabIndex={-1}
        className={`relative min-h-0 flex-1 rounded-md outline-none ${typing ? 'ring-2 ring-primary/60' : ''}`}
        onKeyDown={onKeyDown}
        onFocus={() => setTyping(true)}
        onBlur={() => setTyping(false)}
      >
        <ScreenDrawing snapshot={snapshot} render={render} />
        <svg
          ref={svgRef}
          className="absolute inset-0 h-full w-full cursor-crosshair touch-none select-none"
          viewBox={`0 0 ${screen.width} ${screen.height}`}
          preserveAspectRatio="xMidYMid meet"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerCancel}
          onPointerLeave={() => setPointer(null)}
        >
          <rect x={0} y={0} width={screen.width} height={screen.height} fill="transparent" />
          {marked && (
            <rect
              x={marked.frame.x}
              y={marked.frame.y}
              width={marked.frame.width}
              height={marked.frame.height}
              fill="none"
              className={marked === hovered ? 'stroke-primary' : 'stroke-primary/50'}
              strokeWidth={marked === hovered ? 2.5 : 1.5}
              pointerEvents="none"
            />
          )}
          {hovered && <circle cx={hovered.center.x} cy={hovered.center.y} r={6} className="fill-primary" pointerEvents="none" />}
          {press?.moved && (
            <line
              x1={press.from.x}
              y1={press.from.y}
              x2={press.to.x}
              y2={press.to.y}
              className="stroke-primary"
              strokeWidth={3}
              strokeLinecap="round"
              pointerEvents="none"
            />
          )}
          {press && (
            <circle
              cx={press.from.x}
              cy={press.from.y}
              r={press.held ? 14 : 6}
              className={press.held ? 'fill-primary/30 stroke-primary' : 'fill-primary'}
              strokeWidth={2}
              pointerEvents="none"
            />
          )}
        </svg>
      </div>
    </Column>
  );
}

/** What is on screen with a test id or label; a click taps it. */
export function ElementsWidget() {
  const rootRef = useRef<HTMLDivElement>(null);
  useWatchScreen(rootRef);
  const snapshot = useStore(elementsStore);
  const live = useStore(liveStore);
  const { call } = useConnection();
  const run = useRun();
  const [query, setQuery] = useState('');
  useEffect(() => () => hoveredStore.update(null), []);
  const refresh = () =>
    run('Refresh', async () => {
      const update = await call('screen', {});
      if (update.snapshot) elementsStore.update(update.snapshot);
    });

  const shown = useMemo(() => {
    const needle = query.trim();
    return (snapshot?.elements ?? []).filter((element) => matches(needle, element.label, element.testID));
  }, [snapshot, query]);

  return (
    <div ref={rootRef} className="h-full">
      <Column fill className="h-full">
        <Row gap={2} align="center" className="shrink-0 border-b border-border p-2">
          <SearchField
            size="sm"
            className="w-56"
            placeholder="Label or test id"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onClear={() => setQuery('')}
          />
          <Row gap={1} align="center">
            <Switch checked={live} onCheckedChange={(checked: boolean) => liveStore.update(checked)} />
            <Text variant="caption">Live</Text>
          </Row>
          {!live && (
            <Button size="sm" variant="soft" onClick={refresh}>
              Refresh
            </Button>
          )}
          <Text variant="caption" tone="neutral">
            {snapshot ? `${shown.length} of ${snapshot.elements.length}${snapshot.truncated ? '+' : ''}` : ''}
          </Text>
        </Row>
        <div className="min-h-0 flex-1 overflow-auto" onMouseLeave={() => hoveredStore.update(null)}>
          {shown.map((element, index) => (
            <Row
              key={index}
              gap={2}
              align="center"
              className="cursor-pointer border-b border-border px-3 py-1 hover:bg-muted"
              onMouseEnter={() => hoveredStore.update(element)}
              onClick={() => run('Tap', () => call('tap', element.center))}
            >
              <Column fill>
                <Text className="truncate">{nameOf(element)}</Text>
                {element.testID && element.label && (
                  <Text variant="code" tone="neutral" className="truncate text-xs">
                    {element.testID}
                  </Text>
                )}
              </Column>
              {element.traits.map((trait) => (
                <Badge key={trait} size="sm" tone="neutral" variant="soft">
                  {trait}
                </Badge>
              ))}
              {element.hittable === false && (
                <Badge size="sm" tone="warning" title="Something is drawn over its center, so a tap there lands on that instead">
                  covered
                </Badge>
              )}
              <Text variant="numeric" tone="neutral" className="shrink-0 text-xs">
                {`${element.center.x}, ${element.center.y}`}
              </Text>
            </Row>
          ))}
        </div>
      </Column>
    </div>
  );
}
