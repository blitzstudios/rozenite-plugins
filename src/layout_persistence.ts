import { ValueStore } from './store';
import type { Placement } from './widgets';

export type SavedItem = Placement & { i: string };

/**
 * Favorites, each tab's widget positions, and the heights of fields dragged to a new size (keyed `<widget>:<field>`);
 * a tab, a size or the favorites left out fall through to the next layer.
 */
export type LayoutDocument = { favorites?: string[]; tabs: Record<string, SavedItem[]>; sizes?: Record<string, number> };

/** Where your changes are being kept: on disk through Metro, or only in this browser when Metro can't serve them. */
export type LayoutStorage = 'loading' | 'disk' | 'browser';

/** Kept in step with `ROUTE` in `metro/layout_middleware.cjs`. */
const ROUTE = '/rozenite-panel-layouts';
const WRITE_DELAY_MS = 400;

const emptyDocument = (): LayoutDocument => ({ tabs: {} });

const readLocal = <T>(key: string): T | null => {
  try {
    const raw = window.localStorage.getItem(key);
    return raw == null ? null : (JSON.parse(raw) as T);
  } catch {
    return null;
  }
};

/**
 * A panel's layouts in two layers: the team default (`layout.json`, committed) and your overrides (`layout.user.json`,
 * gitignored), both read through Metro's layout route (`metro/layout_middleware.cjs`), which writes only the overrides.
 * Without the route the overrides live in `localStorage` and the default is `bundledDefault`, the one the panel ships.
 */
export function createLayoutPersistence(namespace: string, bundledDefault: LayoutDocument | null = null) {
  const defaults = new ValueStore<LayoutDocument | null>(null);
  const user = new ValueStore<LayoutDocument>(emptyDocument());
  const storage = new ValueStore<LayoutStorage>('loading');
  const browserKey = `${namespace}:layouts:v2`;
  let writeTimer: ReturnType<typeof setTimeout> | null = null;

  const putUser = (document: LayoutDocument) =>
    fetch(`${ROUTE}/${namespace}/user`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(document) }).then((response) => {
      if (!response.ok) throw new Error(`Saving layout.user.json failed (${response.status})`);
    });

  const persistUser = () => {
    if (writeTimer) clearTimeout(writeTimer);
    writeTimer = setTimeout(() => {
      writeTimer = null;
      const document = user.getSnapshot();
      if (storage.getSnapshot() === 'disk') {
        putUser(document).catch((error) => console.warn('[rozenite panel] could not save layout', error));
      } else {
        try {
          window.localStorage.setItem(browserKey, JSON.stringify(document));
        } catch {
          // Storage full or unavailable: the layout still holds for this session.
        }
      }
    }, WRITE_DELAY_MS);
  };

  fetch(`${ROUTE}/${namespace}`)
    .then((response) => {
      if (!response.ok) throw new Error(String(response.status));
      return response.json() as Promise<{ default: LayoutDocument | null; user: LayoutDocument | null }>;
    })
    .then((files) => {
      defaults.update(files.default);
      storage.update('disk');
      const migrated = files.user ? null : readLocal<LayoutDocument>(browserKey);
      user.update(files.user ?? migrated ?? emptyDocument());
      if (migrated) persistUser();
    })
    .catch(() => {
      defaults.update(bundledDefault);
      storage.update('browser');
      user.update(readLocal<LayoutDocument>(browserKey) ?? emptyDocument());
    });

  const updateUser = (change: (document: LayoutDocument) => LayoutDocument) => {
    user.update((current) => change({ favorites: current.favorites, tabs: { ...current.tabs }, sizes: current.sizes && { ...current.sizes } }));
    persistUser();
  };

  /** Writes one tab's placements, and with them the favorites and field heights, into the team default in `layout.json`. */
  const saveDefault = async (tab: string, items: SavedItem[], favorites?: string[], sizes?: Record<string, number>) => {
    const response = await fetch(`${ROUTE}/${namespace}/default/${encodeURIComponent(tab)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ items, ...(favorites ? { favorites } : {}), ...(sizes ? { sizes } : {}) }),
    });
    if (!response.ok) throw new Error(`Saving layout.json failed (${response.status})`);
    defaults.update((current) => ({
      ...current,
      ...(favorites ? { favorites } : {}),
      ...(sizes ? { sizes: { ...current?.sizes, ...sizes } } : {}),
      tabs: { ...current?.tabs, [tab]: items },
    }));
  };

  return { defaults, user, storage, updateUser, saveDefault };
}

const signature = (items: readonly SavedItem[]) =>
  items
    .map(({ i, x, y, w, h }) => `${i}:${x},${y},${w},${h}`)
    .sort()
    .join('|');

export const sameLayout = (a: readonly SavedItem[], b: readonly SavedItem[]) => signature(a) === signature(b);
