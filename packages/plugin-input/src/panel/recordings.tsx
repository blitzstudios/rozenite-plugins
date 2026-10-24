import { useEffect, useRef, useState } from 'react';
import { Badge, Button, Column, Dialog, EmptyState, Input, Row, Text, Textarea, useConfirmDialog, useCopyToClipboard, useToast } from '@rozenite/ui';
import { ValueStore, useStore } from '@sleeperhq/rozenite-panel-kit';
import { isHold, type PlaybackState, type Point, type RecordedTouch, type Recording, type RecordingEdit, type RecordingSummary } from '../shared/protocol';
import { useConnection } from './connection';
import { errorText, useRun } from './run';

/** The longest gap between touches a replay from the panel keeps, in seconds; empty plays them as recorded. */
const maxGapStore = new ValueStore<string>('', 'input-panel:max-gap:v1');

const maxGapMs = (value: string) => {
  const seconds = Number(value);
  return value.trim() && Number.isFinite(seconds) && seconds >= 0 ? { maxGapMs: Math.round(seconds * 1000) } : {};
};

const touches = (count: number) => `${count} ${count === 1 ? 'touch' : 'touches'}`;

const point = ({ x, y }: Point) => `${Math.round(x)},${Math.round(y)}`;

function describeTouch(touch: RecordedTouch): string {
  const hold = isHold(touch);
  if (touch.to && !hold) return `swipe ${point(touch)} → ${point(touch.to)}`;
  const press = hold ? 'long press' : 'tap';
  if (touch.target) return `${press} ${touch.target.testID ? `#${touch.target.testID}` : `“${touch.target.label}”`}`;
  return `${press} ${point(touch)}`;
}

/** The touches in a recording, each with the screen it was made on, to take out the ones that don't belong. */
function TouchList({ recording }: { recording: RecordingSummary }) {
  const { call } = useConnection();
  const run = useRun();
  const [detail, setDetail] = useState<Recording | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { fileName, eventCount } = recording;

  useEffect(() => {
    let cancelled = false;
    call('readRecording', { fileName }).then(
      (next) => {
        if (cancelled) return;
        setDetail(next);
        setError(null);
      },
      (failure) => !cancelled && setError(errorText(failure)),
    );
    return () => {
      cancelled = true;
    };
  }, [call, fileName, eventCount]);

  if (error)
    return (
      <Text tone="danger" className="px-6 py-1 text-xs">
        {`Couldn’t read it: ${error}`}
      </Text>
    );
  if (!detail)
    return (
      <Text variant="caption" tone="neutral" className="px-6 py-1">
        Reading…
      </Text>
    );
  const edit = (title: string, params: RecordingEdit) => run(title, () => call('editRecording', { fileName, ...params }));
  const count = detail.events.length;

  return (
    <Column className="border-t border-border bg-muted/40 py-1">
      {detail.startScreen && <Text variant="caption" tone="neutral" className="px-6">{`Starts on ${detail.startScreen}`}</Text>}
      {detail.events.map((touch, index) => (
        <Row key={index} gap={2} align="center" className="group px-6 py-0.5 hover:bg-muted">
          <Text variant="numeric" tone="neutral" className="w-8 shrink-0 text-xs">{`#${index + 1}`}</Text>
          <Text variant="numeric" tone="neutral" className="w-14 shrink-0 text-xs">{`+${(touch.t / 1000).toFixed(1)}s`}</Text>
          <Column fill>
            <Text className="truncate text-xs">{describeTouch(touch)}</Text>
            {touch.screen && (
              <Text variant="caption" tone="neutral" className="truncate">
                {touch.screen}
              </Text>
            )}
          </Column>
          <Row gap={1} className="invisible shrink-0 group-hover:visible">
            {index < count - 1 && (
              <Button size="sm" variant="ghost" tone="neutral" title="Cut every touch after this one" onClick={() => edit('Cut', { keepFirst: index + 1 })}>
                Cut after
              </Button>
            )}
            <Button
              size="sm"
              variant="ghost"
              tone="danger"
              disabled={count === 1}
              title="Take this touch out"
              onClick={() => edit('Remove', { remove: [index + 1] })}
            >
              Remove
            </Button>
          </Row>
        </Row>
      ))}
      {detail.endScreen && <Text variant="caption" tone="neutral" className="px-6">{`Ends on ${detail.endScreen}`}</Text>}
    </Column>
  );
}

/** How the last replay went, when it didn't go as recorded. */
function PlaybackReport({ playback }: { playback: PlaybackState }) {
  const { diverged, misses } = playback;
  if (!diverged && misses.length === 0) return null;
  return (
    <Column gap={1} className="shrink-0 border-b border-border px-3 py-1.5">
      {diverged && (
        <Text tone="danger" className="text-xs">
          {`${diverged.atEnd ? `After #${diverged.index}` : `Touch #${diverged.index}`} was recorded on ${diverged.expected}, but the app was on ${
            diverged.actual ?? 'no screen yet'
          }${diverged.stopped ? ', so the replay stopped there.' : '.'}`}
        </Text>
      )}
      {misses.map((miss) => (
        <Text key={miss} tone="warning" className="truncate text-xs" title={miss}>
          {miss}
        </Text>
      ))}
    </Column>
  );
}

function ImportButton() {
  const { call } = useConnection();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [json, setJson] = useState('');
  const [error, setError] = useState<string | null>(null);

  const importIt = () =>
    call('importRecording', { json }).then(
      (summary) => {
        toast.add({ title: `Imported ${summary.name}`, type: 'success' });
        setJson('');
        setError(null);
        setOpen(false);
      },
      (failure) => setError(errorText(failure)),
    );

  return (
    <>
      <Button size="sm" variant="soft" onClick={() => setOpen(true)}>
        Import…
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <Dialog.Content>
          <Dialog.Header>
            <Dialog.Title>Import a recording</Dialog.Title>
            <Dialog.Description>Paste JSON from Copy JSON to save the recording on this device.</Dialog.Description>
          </Dialog.Header>
          <Textarea rows={10} value={json} onChange={(event) => setJson(event.target.value)} placeholder='{ "name": "…", "events": [ … ] }' />
          {error && <Text tone="danger">{error}</Text>}
          <Dialog.Footer>
            <Button variant="soft" tone="neutral" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button disabled={!json.trim()} onClick={importIt}>
              Import
            </Button>
          </Dialog.Footer>
        </Dialog.Content>
      </Dialog>
    </>
  );
}

function RecordingRow({ recording, playing }: { recording: RecordingSummary; playing: boolean }) {
  const { state, call } = useConnection();
  const run = useRun();
  const confirm = useConfirmDialog();
  const { copy } = useCopyToClipboard();
  const toast = useToast();
  const [name, setName] = useState<string | null>(null);
  const cancelRename = useRef(false);
  const [open, setOpen] = useState(false);
  const maxGap = useStore(maxGapStore);
  const playback = state?.playback;

  const rename = () => {
    const next = name?.trim();
    setName(null);
    if (cancelRename.current) {
      cancelRename.current = false;
      return;
    }
    if (next && next !== recording.name) run('Rename', () => call('renameRecording', { fileName: recording.fileName, name: next }));
  };

  return (
    <Column className="border-b border-border">
      <Row gap={2} align="center" className="px-3 py-1.5">
        <Button
          size="sm"
          variant="ghost"
          tone="neutral"
          title={open ? 'Hide the touches' : 'Show the touches, to remove or cut them'}
          onClick={() => setOpen(!open)}
        >
          {open ? '▾' : '▸'}
        </Button>
        <Column fill>
          {name == null ? (
            <Text className="truncate" title="Double-click to rename" onDoubleClick={() => setName(recording.name)}>
              {recording.name}
            </Text>
          ) : (
            <Input
              size="sm"
              autoFocus
              value={name}
              onChange={(event) => setName(event.target.value)}
              onBlur={rename}
              onKeyDown={(event) => {
                if (event.key === 'Escape') cancelRename.current = true;
                if (event.key === 'Enter' || event.key === 'Escape') event.currentTarget.blur();
              }}
            />
          )}
          <Text variant="caption" tone="neutral">
            {`${touches(recording.eventCount)} · ${recording.createdAt ? new Date(recording.createdAt).toLocaleString() : recording.fileName}`}
          </Text>
        </Column>
        {playing && playback ? (
          <>
            <Badge size="sm" tone="success">{`${playback.index} / ${playback.total}`}</Badge>
            <Button size="sm" tone="danger" variant="soft" onClick={() => run('Stop', () => call('stopPlayback'))}>
              Stop
            </Button>
          </>
        ) : (
          <Button
            size="sm"
            disabled={!state?.available || state.recording.active}
            onClick={() => run('Play', () => call('play', { fileName: recording.fileName, ...maxGapMs(maxGap) }))}
          >
            Play
          </Button>
        )}
        <Button
          size="sm"
          variant="soft"
          tone="neutral"
          onClick={() =>
            run('Copy', async () => {
              const { json } = await call('exportRecording', { fileName: recording.fileName });
              await copy(json);
              toast.add({ title: 'Recording JSON copied', type: 'success' });
            })
          }
        >
          Copy JSON
        </Button>
        <Button
          size="sm"
          variant="soft"
          tone="danger"
          onClick={async () => {
            const confirmed = await confirm({
              title: `Delete ${recording.name}?`,
              description: 'Removes it from this device.',
              tone: 'danger',
              confirmLabel: 'Delete',
            });
            if (confirmed) run('Delete', () => call('deleteRecording', { fileName: recording.fileName }));
          }}
        >
          Delete
        </Button>
      </Row>
      {open && <TouchList recording={recording} />}
    </Column>
  );
}

/** Record taps and swipes in the app, and replay them. */
export function RecordingsWidget() {
  const { state, call } = useConnection();
  const run = useRun();
  const toast = useToast();
  const [name, setName] = useState('');
  const maxGap = useStore(maxGapStore);
  if (!state) return null;
  const { recording, recordings, playback } = state;

  const stop = () =>
    run('Saving', async () => {
      const saved = await call('stopRecording', { name: name.trim() || undefined });
      setName('');
      toast.add(
        saved
          ? { title: `Saved ${saved.name}`, description: touches(saved.eventCount), type: 'success' }
          : { title: 'No touches recorded, so nothing was saved', type: 'info' },
      );
    });

  return (
    <Column fill className="h-full">
      <Row gap={2} align="center" wrap className="shrink-0 border-b border-border p-2">
        {recording.active ? (
          <>
            <Badge tone="danger">{`● Recording · ${recording.count}`}</Badge>
            <Input size="sm" className="w-56" placeholder="Name (optional)" value={name} onChange={(event) => setName(event.target.value)} />
            <Button size="sm" tone="danger" onClick={stop}>
              Stop and save
            </Button>
          </>
        ) : (
          <Button size="sm" disabled={!!playback.fileName} onClick={() => run('Recording', () => call('startRecording'))}>
            Record
          </Button>
        )}
        <ImportButton />
        <Row
          gap={1}
          align="center"
          title="Shortens any gap between touches longer than this. Empty plays them as recorded."
        >
          <Text variant="caption">Longest gap</Text>
          <Input
            size="sm"
            className="w-16"
            inputMode="decimal"
            placeholder="as is"
            value={maxGap}
            onChange={(event) => maxGapStore.update(event.target.value)}
          />
          <Text variant="caption">s</Text>
        </Row>
        <Text variant="caption" tone="neutral">
          Records every tap and swipe, yours or sent from here, with the screen it was on. Touches you make inside an RN Modal aren’t recorded.
        </Text>
      </Row>
      <PlaybackReport playback={playback} />
      <div className="min-h-0 flex-1 overflow-auto">
        {recordings.length === 0 ? (
          <EmptyState title="No recordings on this device" description="Record some taps, or import one copied from another device." />
        ) : (
          recordings.map((entry) => <RecordingRow key={entry.fileName} recording={entry} playing={playback.fileName === entry.fileName} />)
        )}
      </div>
    </Column>
  );
}
