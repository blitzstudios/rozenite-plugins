import type { CaptureFile, FileChunk } from './protocol';

type ReadChunk = (path: string, offset: number) => Promise<FileChunk>;
type Progress = (received: number, size: number) => void;

type Writable = { write: (data: Uint8Array) => Promise<void>; close: () => Promise<void>; abort?: () => Promise<void> };
type FileHandle = { name: string; createWritable: () => Promise<Writable> };
type DirectoryHandle = { getFileHandle: (name: string, options: { create: boolean }) => Promise<FileHandle> };
type PickerWindow = Window & {
  showSaveFilePicker?: (options: { suggestedName: string }) => Promise<FileHandle>;
  showDirectoryPicker?: (options: { mode: 'readwrite' }) => Promise<DirectoryHandle>;
};

/** A file as it landed on this machine: the name it was saved under, which the picker may have changed, and its bytes. */
export type SavedFile = { name: string; size: number };

const picker = () => window as PickerWindow;

const decode = (base64: string): Uint8Array<ArrayBuffer> => {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
};

/** Reads `file` off the device a chunk at a time, in order, handing each to `write`. Resolves with the bytes written. */
async function transfer(file: CaptureFile, read: ReadChunk, write: (bytes: Uint8Array<ArrayBuffer>) => Promise<void>, onProgress?: Progress, offset = 0): Promise<number> {
  const chunk = await read(file.path, offset);
  const bytes = decode(chunk.base64);
  if (bytes.length === 0) return offset;
  await write(bytes);
  const next = offset + bytes.length;
  onProgress?.(next, chunk.size);
  return next < chunk.size ? transfer(file, read, write, onProgress, next) : next;
}

const inSequence = <T, R>(items: T[], run: (item: T) => Promise<R>): Promise<R[]> =>
  items.reduce<Promise<R[]>>((previous, item) => previous.then(async (results) => [...results, await run(item)]), Promise.resolve([]));

async function writeTo(handle: FileHandle, file: CaptureFile, read: ReadChunk, onProgress?: Progress): Promise<SavedFile> {
  const writable = await handle.createWritable();
  try {
    const size = await transfer(file, read, (bytes) => writable.write(bytes), onProgress);
    await writable.close();
    return { name: handle.name, size };
  } catch (error) {
    await writable.abort?.().catch(() => undefined);
    throw error;
  }
}

async function downloadInMemory(file: CaptureFile, read: ReadChunk, onProgress?: Progress): Promise<SavedFile> {
  const parts: Uint8Array<ArrayBuffer>[] = [];
  const size = await transfer(
    file,
    read,
    async (bytes) => {
      parts.push(bytes);
    },
    onProgress,
  );
  const url = URL.createObjectURL(new Blob(parts));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = file.filename;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
  return { name: file.filename, size };
}

const isAbort = (error: unknown) => error instanceof DOMException && error.name === 'AbortError';

/**
 * Saves one device file where the user picks, streaming it to disk; without the File System Access
 * API, it downloads through the browser instead. Must start from a click: the picker needs one.
 * Resolves null when the user cancels the picker.
 */
export async function saveFile(file: CaptureFile, read: ReadChunk, onProgress?: Progress): Promise<SavedFile | null> {
  const showSaveFilePicker = picker().showSaveFilePicker;
  if (!showSaveFilePicker) return downloadInMemory(file, read, onProgress);
  let handle: FileHandle;
  try {
    handle = await showSaveFilePicker.call(window, { suggestedName: file.filename });
  } catch (error) {
    if (isAbort(error)) return null;
    return downloadInMemory(file, read, onProgress);
  }
  return writeTo(handle, file, read, onProgress);
}

/** Saves several files into one folder the user picks, so a capture's artifacts land together. Resolves null when the user cancels. */
export async function saveFiles(files: CaptureFile[], read: ReadChunk, onProgress?: (file: CaptureFile, received: number, size: number) => void): Promise<SavedFile[] | null> {
  const showDirectoryPicker = picker().showDirectoryPicker;
  if (!showDirectoryPicker) return inSequence(files, (file) => downloadInMemory(file, read, (received, size) => onProgress?.(file, received, size)));
  let directory: DirectoryHandle;
  try {
    directory = await showDirectoryPicker.call(window, { mode: 'readwrite' });
  } catch (error) {
    if (isAbort(error)) return null;
    throw error;
  }
  return inSequence(files, async (file) => {
    const handle = await directory.getFileHandle(file.filename, { create: true });
    return writeTo(handle, file, read, (received, size) => onProgress?.(file, received, size));
  });
}
