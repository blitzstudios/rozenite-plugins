import type { Point, RecordedTouch, Recording, RecordingEdit, RecordingSummary, TapTarget } from '../shared/protocol';
import { inputOptions } from './config';
import { editedRecording } from './recording_edits';
import { memoryRecordingStorage } from './storage';

/**
 * Tap recordings, one JSON file each in the configured storage. The file name is a timestamp that never changes;
 * the display name lives inside, so renaming never moves the file.
 */

const fallback = memoryRecordingStorage();
const storage = () => inputOptions().storage ?? fallback;

const summarize = (fileName: string, recording: Recording): RecordingSummary => ({
  fileName,
  name: recording.name || fileName,
  createdAt: recording.createdAt || '',
  eventCount: Array.isArray(recording.events) ? recording.events.length : 0,
});

export async function writeRecording(recording: Recording): Promise<RecordingSummary> {
  const fileName = `tap-recording-${recording.createdAt.replace(/[:.]/g, '-')}.json`;
  await storage().write(fileName, JSON.stringify(recording));
  return summarize(fileName, recording);
}

/** Newest first, skipping files that don't parse. */
export async function listRecordings(): Promise<RecordingSummary[]> {
  const files = (await storage().list()).filter((name) => name.endsWith('.json'));
  const summaries = await Promise.all(
    files.map(async (fileName) => {
      try {
        return summarize(fileName, JSON.parse(await storage().read(fileName)) as Recording);
      } catch {
        return null;
      }
    }),
  );
  return summaries.filter((summary): summary is RecordingSummary => !!summary).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function readRecording(fileName: string): Promise<Recording> {
  return JSON.parse(await storage().read(fileName)) as Recording;
}

export async function renameRecording(fileName: string, name: string): Promise<void> {
  const recording = await readRecording(fileName);
  await storage().write(fileName, JSON.stringify({ ...recording, name }));
}

/** Removes or cuts touches in place, keeping the file name. */
export async function editRecording(fileName: string, edit: RecordingEdit): Promise<RecordingSummary> {
  const edited = editedRecording(await readRecording(fileName), edit);
  await storage().write(fileName, JSON.stringify(edited));
  return summarize(fileName, edited);
}

export async function deleteRecording(fileName: string): Promise<void> {
  await storage().remove(fileName);
}

const isPoint = (value: unknown): value is Point => !!value && typeof (value as Point).x === 'number' && typeof (value as Point).y === 'number';

const targetOf = (value: unknown): TapTarget | null => {
  const { testID, label } = (value ?? {}) as Record<string, unknown>;
  if (typeof testID === 'string') return { testID };
  if (typeof label === 'string') return { label };
  return null;
};

/** Saves a recording pasted as JSON, under a new file name. */
export async function importRecording(json: string): Promise<RecordingSummary> {
  let parsed: Partial<Recording> | null;
  try {
    parsed = JSON.parse(json) as Partial<Recording> | null;
  } catch {
    throw new Error('Not valid JSON.');
  }
  if (!parsed || !Array.isArray(parsed.events)) throw new Error('Not a tap recording: it has no events.');
  const events: RecordedTouch[] = parsed.events.filter(isPoint).map((event) => {
    const target = targetOf(event.target);
    return {
      x: event.x,
      y: event.y,
      t: typeof event.t === 'number' ? event.t : 0,
      ...(isPoint(event.to) ? { to: { x: event.to.x, y: event.to.y } } : {}),
      ...(isPoint(event.to) && typeof event.durationMs === 'number' ? { durationMs: event.durationMs } : {}),
      ...(target ? { target } : {}),
      ...(typeof event.screen === 'string' ? { screen: event.screen } : {}),
    };
  });
  if (events.length === 0) throw new Error('The recording has no taps.');
  const screen = parsed.screen ?? { width: 0, height: 0, scale: 1 };
  const name = typeof parsed.name === 'string' && parsed.name.trim() ? parsed.name : 'Imported recording';
  const startScreen = typeof parsed.startScreen === 'string' ? parsed.startScreen : undefined;
  const endScreen = typeof parsed.endScreen === 'string' ? parsed.endScreen : undefined;
  return writeRecording({
    name,
    createdAt: new Date().toISOString(),
    screen,
    ...(startScreen ? { startScreen } : {}),
    ...(endScreen ? { endScreen } : {}),
    events,
  });
}
