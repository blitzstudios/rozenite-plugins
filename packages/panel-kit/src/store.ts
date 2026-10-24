import { useSyncExternalStore } from 'react';

type Listener = () => void;

export class Observable<T> {
  private listeners = new Set<Listener>();

  protected value: T;

  constructor(initial: T) {
    this.value = initial;
  }

  subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): T => this.value;

  protected set(value: T): void {
    this.value = value;
    this.listeners.forEach((listener) => listener());
  }
}

/**
 * The events of one stream the panel has seen, oldest first, capped at `limit`. With `idOf`, a batch
 * upserts: an event whose id is already held replaces it in place.
 */
export class StreamStore<T> extends Observable<T[]> {
  private indexById = new Map<string | number, number>();

  constructor(
    private readonly limit: number,
    private readonly idOf?: (event: T) => string | number,
  ) {
    super([]);
  }

  apply(events: T[], reset: boolean): void {
    const next = reset ? [] : this.value.slice();
    if (reset) this.indexById.clear();
    for (const event of events) {
      const id = this.idOf?.(event);
      const at = id == null ? undefined : this.indexById.get(id);
      if (at != null) {
        next[at] = event;
      } else {
        if (id != null) this.indexById.set(id, next.length);
        next.push(event);
      }
    }
    if (next.length > this.limit) {
      next.splice(0, next.length - this.limit);
      this.reindex(next);
    }
    this.set(next);
  }

  clear(): void {
    this.indexById.clear();
    this.set([]);
  }

  private reindex(events: T[]): void {
    if (!this.idOf) return;
    this.indexById.clear();
    events.forEach((event, index) => this.indexById.set(this.idOf!(event), index));
  }
}

/** A single value, kept in `localStorage` under `key` when one is given. */
export class ValueStore<T> extends Observable<T> {
  constructor(
    initial: T,
    private readonly key?: string,
  ) {
    super(ValueStore.read(key, initial));
  }

  private static read<T>(key: string | undefined, fallback: T): T {
    if (!key) return fallback;
    try {
      const raw = window.localStorage.getItem(key);
      return raw == null ? fallback : (JSON.parse(raw) as T);
    } catch {
      return fallback;
    }
  }

  update(next: T | ((current: T) => T)): void {
    const value = typeof next === 'function' ? (next as (current: T) => T)(this.value) : next;
    if (this.key) {
      try {
        window.localStorage.setItem(this.key, JSON.stringify(value));
      } catch {
        // Storage full or unavailable: the value still holds for this session.
      }
    }
    this.set(value);
  }
}

export function useStore<T>(store: Observable<T>): T {
  return useSyncExternalStore(store.subscribe, store.getSnapshot);
}
