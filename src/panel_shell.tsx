import { useCallback, useEffect, useMemo, useRef, type ReactNode } from 'react';
import { Button, EmptyState, PluginShell, useConfirmDialog, useToast } from '@rozenite/ui';
import { ValueStore, useStore } from './store';
import { OVERVIEW, type createWidgetBoard } from './widgets';

export type PanelTab<Tab extends string> = {
  key: Tab | typeof OVERVIEW;
  label: string;
  /** A short count shown at the right of the tab's sidebar row. */
  Meta?: () => ReactNode;
};

type Board<Tab extends string> = ReturnType<typeof createWidgetBoard<Tab>>;

export type PanelLayoutProps<Tab extends string> = {
  title: string;
  namespace: string;
  tabs: PanelTab<Tab>[];
  board: Board<Tab>;
  connected: boolean;
  /** Whether the app has ever answered, to tell a stall from a first connection. */
  seen: boolean;
  recording?: boolean;
  /** Whether the app has answered yet; until it has, the main area explains what to do. */
  ready: boolean;
  waitingDescription: string;
  /** The sidebar heading over every tab but the favorites tab. */
  tabsHeading: string;
  /** Shown next to the open tab's title. */
  headerExtras?: ReactNode;
};

// The panels follow the system appearance and offer no theme switch, but `PluginShell` obeys a choice saved under
// this key over the system, and an earlier switch saved one. Cleared before the shell first reads it.
try {
  window.localStorage.removeItem('@rozenite/ui:theme');
} catch {
  // Storage unavailable: the shell reads nothing and follows the system.
}

const SIDEBAR_WIDTH = { initial: 200, min: 160, max: 480 };
const clampWidth = (width: number) => Math.round(Math.min(SIDEBAR_WIDTH.max, Math.max(SIDEBAR_WIDTH.min, width)));

const tabStores = new Map<string, ValueStore<string>>();
const widthStores = new Map<string, ValueStore<number>>();

const isTyping = (target: EventTarget | null) =>
  target instanceof HTMLElement && (target.isContentEditable || target.closest('input, textarea, select, [role="textbox"], [role="combobox"], [role="listbox"]') !== null);

/** Up and down arrows open the previous and next tab in sidebar order, unless focus is in a field or a dialog is open. */
function useArrowKeyTabs(order: string[], current: string, open: (key: string) => void) {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
      if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
      if (isTyping(event.target) || document.querySelector('[role="dialog"], [role="alertdialog"]')) return;
      const index = order.indexOf(current);
      const next = order[Math.min(order.length - 1, Math.max(0, index + (event.key === 'ArrowDown' ? 1 : -1)))];
      event.preventDefault();
      if (next && next !== current) open(next);
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [order, current, open]);
}

function storeFor<T>(stores: Map<string, ValueStore<T>>, key: string, initial: T): ValueStore<T> {
  let store = stores.get(key);
  if (!store) {
    store = new ValueStore<T>(initial, key);
    stores.set(key, store);
  }
  return store;
}

/** A sidebar of tabs and the open tab's widgets. The `OVERVIEW` tab, if listed, shows the favorites. */
export function PanelLayout<Tab extends string>({
  title,
  namespace,
  tabs,
  board,
  connected,
  seen,
  recording,
  ready,
  waitingDescription,
  tabsHeading,
  headerExtras,
}: PanelLayoutProps<Tab>) {
  const tabStore = useMemo(() => storeFor(tabStores, `${namespace}:tab:v1`, tabs[0].key as string), [namespace, tabs]);
  const widthStore = useMemo(() => storeFor(widthStores, `${namespace}:sidebarWidth:v1`, SIDEBAR_WIDTH.initial), [namespace]);
  const stored = useStore(tabStore);
  const width = clampWidth(useStore(widthStore));
  const tab = tabs.find((entry) => entry.key === stored) ?? tabs[0];
  const favorites = board.useFavorites();
  const confirm = useConfirmDialog();
  const toast = useToast();

  const onResetLayout = async () => {
    const confirmed = await confirm({
      title: `Reset ${tab.label}?`,
      description: tab.key === OVERVIEW ? 'Puts your favorites and their arrangement back to the team default.' : `Puts ${tab.label}'s widgets back where the team default has them.`,
      tone: 'danger',
      confirmLabel: 'Reset',
    });
    if (confirmed) board.resetLayout(tab.key);
  };

  const canSaveAsDefault = board.useCanSaveAsDefault(tab.key);
  const onSaveAsDefault = async () => {
    const confirmed = await confirm({
      title: `Make this the default ${tab.label}?`,
      description: `Writes ${tab.key === OVERVIEW ? 'your favorites and their arrangement' : `${tab.label}'s widget positions`} into rozenite-plugins/layout.json, the team default everyone gets until they move things themselves. Commit the file to share it.`,
      confirmLabel: 'Save as default',
    });
    if (!confirmed) return;
    try {
      await board.saveAsDefault(tab.key);
      toast.add({ title: `${tab.label} saved to layout.json`, type: 'success' });
    } catch (error) {
      toast.add({ title: 'Could not save the default', description: error instanceof Error ? error.message : String(error), type: 'error' });
    }
  };

  const connection = connected ? (recording ? 'recording' : 'live') : seen ? 'reconnecting' : 'waiting for app';
  const overview = tabs.filter((entry) => entry.key === OVERVIEW);
  const rest = tabs.filter((entry) => entry.key !== OVERVIEW);
  const order = useMemo(() => [...tabs].sort((a, b) => Number(b.key === OVERVIEW) - Number(a.key === OVERVIEW)).map((entry) => entry.key as string), [tabs]);
  const openTab = useCallback((key: string) => tabStore.update(key), [tabStore]);
  useArrowKeyTabs(order, tab.key, openTab);
  const navItem = ({ key, label, Meta }: PanelTab<Tab>) => (
    <button
      key={key}
      type="button"
      className={`sk-nav-item${key === tab.key ? ' sk-nav-item-active' : ''}`}
      ref={key === tab.key ? (node) => node?.scrollIntoView({ block: 'nearest' }) : undefined}
      onClick={() => tabStore.update(key)}
    >
      <span className="sk-nav-name">{label}</span>
      {key === OVERVIEW && favorites.length > 0 && <span className="sk-nav-meta">{`★ ${favorites.length}`}</span>}
      {Meta && (
        <span className="sk-nav-meta">
          <Meta />
        </span>
      )}
    </button>
  );

  return (
    <div className="sk-panel">
      <nav className="sk-sidebar" style={{ width }}>
        <div className="sk-brand">
          <span className="sk-brand-name">{title}</span>
          <span className={`sk-connection${connected ? ` sk-connection-${recording ? 'recording' : 'live'}` : ''}`}>{connection}</span>
        </div>
        {overview.map(navItem)}
        {rest.length > 0 && <div className="sk-nav-heading">{tabsHeading}</div>}
        {rest.map(navItem)}
      </nav>
      <SidebarResizer width={width} onResize={(next) => widthStore.update(clampWidth(next))} />
      <main className="sk-main">
        {ready ? (
          <>
            <header className="sk-header">
              <h2>{tab.label}</h2>
              {headerExtras}
              <span className="flex-1" />
              <Button
                size="sm"
                variant="ghost"
                tone="neutral"
                className="shrink-0"
                disabled={!canSaveAsDefault}
                onClick={onSaveAsDefault}
                title={canSaveAsDefault ? 'Make this arrangement the team default in layout.json' : 'This tab already matches the team default, or Metro is not serving the layout files'}
              >
                Save as default
              </Button>
              <Button size="sm" variant="ghost" tone="neutral" className="shrink-0" onClick={onResetLayout} title="Put this tab back to the team default">
                Reset layout
              </Button>
            </header>
            <board.Dashboard key={tab.key} tab={tab.key} />
          </>
        ) : (
          <EmptyState title="Waiting for the app" description={waitingDescription} />
        )}
      </main>
    </div>
  );
}

/** The sidebar's right edge, dragged to resize it; a double click puts it back. */
function SidebarResizer({ width, onResize }: { width: number; onResize: (width: number) => void }) {
  const drag = useRef<{ x: number; width: number }>(undefined);
  return (
    <div
      className="sk-sidebar-resizer"
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize sidebar"
      aria-valuenow={width}
      aria-valuemin={SIDEBAR_WIDTH.min}
      aria-valuemax={SIDEBAR_WIDTH.max}
      onPointerDown={(event) => {
        event.preventDefault();
        event.currentTarget.setPointerCapture(event.pointerId);
        drag.current = { x: event.clientX, width };
      }}
      onPointerMove={(event) => {
        if (drag.current) onResize(drag.current.width + event.clientX - drag.current.x);
      }}
      onPointerUp={() => {
        drag.current = undefined;
      }}
      onPointerCancel={() => {
        drag.current = undefined;
      }}
      onDoubleClick={() => onResize(SIDEBAR_WIDTH.initial)}
    />
  );
}

export { PluginShell };
