import { useEffect, useState } from 'react';
import type { ApplyResult, Control, ControlValue, SectionSnapshot } from '../protocol';

/**
 * One section of controls, as data: the panel (and an in-app menu, if the app draws one) renders `read()`, and
 * changes the app through `apply`. Throwing from `apply` reports the message to whoever applied it.
 */
export type ControlSection = {
  id: string;
  title: string;
  description?: string;
  searchable?: boolean;
  read: () => Control[];
  /** Calls `onChange` whenever what `read` returns may have changed; returns the unsubscribe. */
  subscribe: (onChange: () => void) => () => void;
  apply: (controlId: string, value: ControlValue) => Promise<ApplyResult | void> | ApplyResult | void;
  /** The value behind an `inspectable` info row, read only when someone opens it. */
  inspect?: (controlId: string) => unknown;
};

export type ControlTab = { id: string; title: string; sections: ControlSection[] };

export function snapshotSection(section: ControlSection): SectionSnapshot {
  return { id: section.id, title: section.title, description: section.description, searchable: section.searchable, controls: section.read() };
}

/** Subscribes to every source at once. */
export function subscribeAll(...sources: ((onChange: () => void) => () => void)[]): (onChange: () => void) => () => void {
  return (onChange) => {
    const unsubscribes = sources.map((subscribe) => subscribe(onChange));
    return () => unsubscribes.forEach((unsubscribe) => unsubscribe());
  };
}

/** Passes a busy source's changes on at most once every `ms`. */
export function throttleSubscribe(subscribe: (onChange: () => void) => () => void, ms: number): (onChange: () => void) => () => void {
  return (onChange) => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const unsubscribe = subscribe(() => {
      timer ??= setTimeout(() => {
        timer = null;
        onChange();
      }, ms);
    });
    return () => {
      if (timer) clearTimeout(timer);
      unsubscribe();
    };
  };
}

/** A form control's submitted fields. */
export function formFields(value: ControlValue): Record<string, string> {
  if (typeof value !== 'string') return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

/** For state nothing else reports changes to: call `notify` after changing it. */
export function createChangeSignal() {
  const listeners = new Set<() => void>();
  return {
    subscribe: (onChange: () => void) => {
      listeners.add(onChange);
      return () => listeners.delete(onChange);
    },
    notify: () => listeners.forEach((listener) => listener()),
  };
}

/**
 * A value that loads asynchronously, for a section's synchronous `read`: `get` starts the load on first use
 * and answers `fallback` until it lands, then `signal` reports the change. `reload` loads it again.
 */
export function createAsyncValue<T>(load: () => Promise<T>, fallback: T) {
  const signal = createChangeSignal();
  let value = fallback;
  let started = false;
  const reload = (): Promise<T> => {
    started = true;
    return load().then(
      (next) => {
        value = next;
        signal.notify();
        return next;
      },
      () => value,
    );
  };
  return {
    get: () => {
      if (!started) reload();
      return value;
    },
    /** The value so far, without starting a load. */
    peek: () => value,
    reload,
    subscribe: signal.subscribe,
  };
}

/** Reads `section`'s inspectable row `controlId`, failing with a message a person can read. */
export async function inspectSection(section: ControlSection, controlId: string): Promise<unknown> {
  if (!section.inspect) throw new Error(`${section.title} has nothing to inspect`);
  return section.inspect(controlId);
}

/** A section's controls, re-read whenever the section reports a change that altered them. */
export function useSectionControls(section: ControlSection): Control[] {
  const [controls, setControls] = useState(section.read);
  useEffect(() => {
    let current = section.read();
    let json = JSON.stringify(current);
    setControls(current);
    return section.subscribe(() => {
      const next = section.read();
      const nextJson = JSON.stringify(next);
      if (nextJson === json) return;
      json = nextJson;
      current = next;
      setControls(current);
    });
  }, [section]);
  return controls;
}
