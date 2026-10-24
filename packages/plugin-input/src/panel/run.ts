import { useCallback } from 'react';
import { useToast } from '@rozenite/ui';

export const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error));

/** `run(title, fn)` toasts "`title` failed" when `fn` rejects, and never rejects itself. */
export function useRun() {
  const toast = useToast();
  return useCallback(
    (title: string, fn: () => Promise<unknown>): Promise<void> =>
      fn().then(
        () => undefined,
        (error) => {
          toast.add({ title: `${title} failed`, description: errorText(error), type: 'error' });
        },
      ),
    [toast],
  );
}
