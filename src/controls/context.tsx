import { createContext, useContext, type ReactNode } from 'react';
import type { RozeniteDevToolsClient } from '@rozenite/plugin-bridge';
import type { Call } from '../connection';
import { ValueStore } from '../store';
import type { ControlsEventMap, ControlsMethods, SectionSnapshot } from './protocol';

/** Every section the app has described, by id. */
export type SectionsStore = ValueStore<Record<string, SectionSnapshot>>;

export const createSectionsStore = (): SectionsStore => new ValueStore<Record<string, SectionSnapshot>>({});

/** Replaces a section in `sections` each time the app pushes it; for `createConnection`'s `listen`. */
export function listenToSections<E extends ControlsEventMap>(client: RozeniteDevToolsClient<E>, sections: SectionsStore, seen: () => void) {
  return client.onMessage('controls:section', ({ json }) => {
    const section = JSON.parse(json) as SectionSnapshot;
    sections.update((current) => ({ ...current, [section.id]: section }));
    seen();
  });
}

/** Loads every section into `sections`, as on attach. */
export async function loadSections(call: Call<ControlsMethods>, sections: SectionsStore): Promise<void> {
  const all = await call('sections');
  sections.update(Object.fromEntries(all.map((section) => [section.id, section])));
}

type ControlsValue = { sections: SectionsStore; call: Call<ControlsMethods> };

const ControlsContext = createContext<ControlsValue | null>(null);

/** What `SectionWidget`, `SectionCount` and `OverridesButton` read and call through. */
export function ControlsProvider({ sections, call, children }: ControlsValue & { children: ReactNode }) {
  return <ControlsContext.Provider value={{ sections, call }}>{children}</ControlsContext.Provider>;
}

export function useControls(): ControlsValue {
  const value = useContext(ControlsContext);
  if (!value) throw new Error('Controls render inside a ControlsProvider');
  return value;
}
