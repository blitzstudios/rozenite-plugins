import { useState, type ReactNode } from 'react';
import { Badge, Button, Column, EmptyState, Input, Row, Text } from '@rozenite/ui';
import { formatTime } from '@sleeperhq/rozenite-panel-kit';
import { DEFAULT_SWIPE_MS } from '../shared/protocol';
import { useConnection } from './connection';
import { useRun } from './run';

function NumberField({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return <Input size="sm" className="w-16" inputMode="numeric" aria-label={label} placeholder={label} value={value} onChange={(event) => onChange(event.target.value)} />;
}

function Line({ label, children }: { label: string; children: ReactNode }) {
  return (
    <Row gap={2} align="center" wrap>
      <Text variant="caption" className="w-12 shrink-0">
        {label}
      </Text>
      {children}
    </Row>
  );
}

const parse = (...values: string[]) => {
  const numbers = values.map(Number);
  return values.every((value) => value.trim() !== '') && numbers.every(Number.isFinite) ? numbers : null;
};

/** A tap or swipe at typed coordinates, and text into the focused field. */
export function ManualInputWidget() {
  const { state, call } = useConnection();
  const run = useRun();
  const [tap, setTap] = useState({ x: '', y: '' });
  const [swipe, setSwipe] = useState({ fromX: '', fromY: '', toX: '', toY: '', ms: String(DEFAULT_SWIPE_MS) });
  const [text, setText] = useState('');
  const disabled = !state?.available;

  const type = () => {
    if (disabled || !text) return;
    run('Typing', async () => {
      await call('typeText', { text });
      setText('');
    });
  };

  const tapPoint = parse(tap.x, tap.y);
  const swipePoints = parse(swipe.fromX, swipe.fromY, swipe.toX, swipe.toY, swipe.ms);

  return (
    <Column gap={3} className="h-full overflow-auto p-3">
      <Line label="Tap">
        <NumberField label="x" value={tap.x} onChange={(x) => setTap({ ...tap, x })} />
        <NumberField label="y" value={tap.y} onChange={(y) => setTap({ ...tap, y })} />
        <Button size="sm" disabled={disabled || !tapPoint} onClick={() => tapPoint && run('Tap', () => call('tap', { x: tapPoint[0], y: tapPoint[1] }))}>
          Tap
        </Button>
      </Line>
      <Line label="Swipe">
        <NumberField label="from x" value={swipe.fromX} onChange={(fromX) => setSwipe({ ...swipe, fromX })} />
        <NumberField label="from y" value={swipe.fromY} onChange={(fromY) => setSwipe({ ...swipe, fromY })} />
        <Text tone="neutral">→</Text>
        <NumberField label="to x" value={swipe.toX} onChange={(toX) => setSwipe({ ...swipe, toX })} />
        <NumberField label="to y" value={swipe.toY} onChange={(toY) => setSwipe({ ...swipe, toY })} />
        <NumberField label="ms" value={swipe.ms} onChange={(ms) => setSwipe({ ...swipe, ms })} />
        <Button
          size="sm"
          disabled={disabled || !swipePoints}
          onClick={() =>
            swipePoints &&
            run('Swipe', () => call('swipe', { from: { x: swipePoints[0], y: swipePoints[1] }, to: { x: swipePoints[2], y: swipePoints[3] }, durationMs: swipePoints[4] }))
          }
        >
          Swipe
        </Button>
      </Line>
      <Line label="Type">
        <Input
          size="sm"
          className="min-w-40 flex-1"
          placeholder="Into the focused field"
          value={text}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={(event) => event.key === 'Enter' && type()}
        />
        <Button size="sm" disabled={disabled || !text} onClick={type}>
          Type
        </Button>
      </Line>
    </Column>
  );
}

const SOURCE_TONE = { panel: 'neutral', agent: 'info', replay: 'success' } as const;

/** The inputs the app was sent, from this panel, an agent or a replay, newest first. */
export function InputLogWidget() {
  const { state } = useConnection();
  const log = state?.log ?? [];
  if (log.length === 0) return <EmptyState title="Nothing sent yet" description="Taps, swipes and text from this panel, an agent or a replay." />;
  return (
    <div className="h-full overflow-auto">
      {[...log].reverse().map((entry) => (
        <Row key={entry.id} gap={2} align="center" className="border-b border-border px-3 py-1">
          <Text variant="numeric" tone="neutral" className="shrink-0 text-xs">
            {formatTime(entry.at)}
          </Text>
          <Badge size="sm" variant="soft" tone={SOURCE_TONE[entry.source]}>
            {entry.source}
          </Badge>
          <Text className="shrink-0">{entry.kind}</Text>
          <Text variant="code" tone="neutral" className="truncate text-xs">
            {entry.detail}
          </Text>
          {entry.error && (
            <Text tone="danger" className="truncate text-xs" title={entry.error}>
              {entry.error}
            </Text>
          )}
        </Row>
      ))}
    </div>
  );
}
