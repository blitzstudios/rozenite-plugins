import type { RozeniteDevToolsClient, RozeniteRpc } from '@rozenite/plugin-bridge';
import type { ApplyResult, ControlTabs, ControlValue, ControlsEventMap, ControlsMethods, SectionSnapshot } from '../protocol';
import { inspectSection, snapshotSection, type ControlSection, type ControlTab } from './sections';

/** How long section changes gather before they go to the panels together. */
const FLUSH_MS = 150;

/** A section that fails to read shows the failure rather than taking the panel down with it. */
function safeSnapshot(section: ControlSection): SectionSnapshot {
  try {
    return snapshotSection(section);
  } catch (error) {
    return {
      id: section.id,
      title: section.title,
      controls: [{ kind: 'info', id: 'error', label: 'Could not read this section', value: error instanceof Error ? error.message : String(error) }],
    };
  }
}

/** What the panel's calls and the agent tools do, shared so the two can't drift. */
export type ControlOperations = {
  tabs: () => ControlTabs;
  section: (sectionId: string) => SectionSnapshot;
  sections: () => SectionSnapshot[];
  apply: (sectionId: string, controlId: string, value: ControlValue, options?: { restart?: boolean }) => Promise<ApplyResult>;
  inspect: (sectionId: string, controlId: string) => Promise<unknown>;
};

export type ControlsOptions = {
  /** The tabs, in order, and the sections each shows. */
  tabs: ControlTab[];
  /** Restarts the app, for a control whose change only takes effect after one. */
  restart?: () => void;
};

export type ControlsServer = {
  operations: ControlOperations;
  /** While watching, each section pushes itself again as its values change; call it as panels attach and leave. */
  setWatching: (watching: boolean) => void;
  stop: () => void;
};

/**
 * Answers a plugin's panel for `tabs`' sections, through the plugin's own `rpc` (one per client, since an RPC answers
 * every method it has no handler for with an error), beside the plugin's other calls.
 */
export function serveControls<E extends ControlsEventMap, M extends ControlsMethods>(
  pluginClient: RozeniteDevToolsClient<E>,
  pluginRpc: RozeniteRpc<M>,
  { tabs, restart }: ControlsOptions,
): ControlsServer {
  // The plugin's client and RPC carry its own events and calls too; only the controls' are used here.
  const client = pluginClient as unknown as RozeniteDevToolsClient<ControlsEventMap>;
  const rpc = pluginRpc as unknown as RozeniteRpc<ControlsMethods>;
  const sections: Record<string, ControlSection> = Object.fromEntries(tabs.flatMap((tab) => tab.sections.map((section) => [section.id, section])));
  const sectionOrThrow = (sectionId: string): ControlSection => {
    const section = sections[sectionId];
    if (!section) throw new Error(`No section ${sectionId}`);
    return section;
  };
  const lastSent = new Map<string, string>();
  const dirty = new Set<string>();
  let timer: ReturnType<typeof setTimeout> | null = null;
  let unwatch: (() => void)[] = [];

  const flush = () => {
    timer = null;
    dirty.forEach((id) => {
      const section = sections[id];
      if (!section) return;
      const json = JSON.stringify(safeSnapshot(section));
      if (lastSent.get(id) === json) return;
      lastSent.set(id, json);
      client.send('controls:section', { json });
    });
    dirty.clear();
  };

  const markDirty = (id: string) => {
    dirty.add(id);
    timer ??= setTimeout(flush, FLUSH_MS);
  };

  const setWatching = (watching: boolean) => {
    unwatch.forEach((stop) => stop());
    unwatch = watching ? Object.values(sections).map((section) => section.subscribe(() => markDirty(section.id))) : [];
    if (!watching) {
      if (timer) clearTimeout(timer);
      timer = null;
      dirty.clear();
      lastSent.clear();
    }
  };

  const operations: ControlOperations = {
    tabs: () => tabs.map((tab) => ({ id: tab.id, title: tab.title, sectionIds: tab.sections.map((section) => section.id) })),
    section: (sectionId) => safeSnapshot(sectionOrThrow(sectionId)),
    sections: () => Object.values(sections).map(safeSnapshot),
    apply: async (sectionId, controlId, value, options) => {
      const section = sectionOrThrow(sectionId);
      try {
        const result = (await section.apply(controlId, value)) ?? {};
        if (options?.restart) restart?.();
        return result;
      } finally {
        markDirty(sectionId);
      }
    },
    inspect: (sectionId, controlId) => inspectSection(sectionOrThrow(sectionId), controlId),
  };

  const subscriptions = [
    rpc.handle('sections', async () =>
      operations.sections().map((snapshot) => {
        lastSent.set(snapshot.id, JSON.stringify(snapshot));
        return snapshot;
      }),
    ),
    rpc.handle('apply', ({ sectionId, controlId, value, restart: restartAfter }) => operations.apply(sectionId, controlId, value, { restart: restartAfter })),
    rpc.handle('inspect', async ({ sectionId, controlId }) => ({ json: JSON.stringify(await operations.inspect(sectionId, controlId)) ?? 'null' })),
  ];

  return {
    operations,
    setWatching,
    stop: () => {
      setWatching(false);
      subscriptions.forEach((subscription) => subscription.remove());
    },
  };
}
