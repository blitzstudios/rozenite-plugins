import { useState } from 'react';
import type { SavedFile } from './download';

const REVEAL_URL = '/rozenite-panel-files/reveal';

type RevealState = { kind: 'idle' } | { kind: 'looking' } | { kind: 'failed'; message: string };

async function reveal(files: SavedFile[], savedAfter: number): Promise<void> {
  const response = await fetch(REVEAL_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ files, savedAfter }),
  });
  if (response.ok) return;
  const body = (await response.json().catch(() => null)) as { error?: string } | null;
  throw new Error(response.status === 404 && !body?.error ? 'Restart Metro to enable Show in Finder.' : (body?.error ?? `Failed (${response.status})`));
}

/** Shows files the panel just saved in Finder. The dev server looks them up, since a save picker never says where they went. */
export function ShowInFinder({ files, savedAfter }: { files: SavedFile[]; savedAfter: number }) {
  const [state, setState] = useState<RevealState>({ kind: 'idle' });
  const onClick = async () => {
    setState({ kind: 'looking' });
    try {
      await reveal(files, savedAfter);
      setState({ kind: 'idle' });
    } catch (error) {
      setState({ kind: 'failed', message: error instanceof Error ? error.message : String(error) });
    }
  };
  return (
    <span className="flex flex-col gap-0.5">
      <button type="button" className="w-fit cursor-pointer text-primary underline-offset-2 hover:underline disabled:cursor-default disabled:opacity-60" disabled={state.kind === 'looking'} onClick={onClick}>
        {state.kind === 'looking' ? 'Looking…' : 'Show in Finder'}
      </button>
      {state.kind === 'failed' && <span className="text-danger">{state.message}</span>}
    </span>
  );
}
