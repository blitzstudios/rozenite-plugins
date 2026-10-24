import { Component, createContext, useContext, useEffect, useMemo, useRef, useState, type ComponentType, type ErrorInfo, type ReactNode } from 'react';
import GridLayout, { type LayoutItem } from 'react-grid-layout';
import { EmptyState, Text } from '@rozenite/ui';
import { useStore } from './store';
import { createLayoutPersistence, sameLayout, type LayoutDocument, type LayoutStorage } from './layout_persistence';

export const OVERVIEW = 'overview';
export const GRID_COLUMNS = 12;
export const GRID_ROWS = 12;

const GAP = 8;
/** Below this the rows stop shrinking with the panel, and the tab scrolls instead. */
const MIN_ROW_HEIGHT = 28;

/** A position on a tab's grid, in grid units: 12 columns, and rows sized so 12 fill the panel's height. */
export type Placement = { x: number; y: number; w: number; h: number };

export type WidgetDefinition<Tab extends string = string> = {
  id: string;
  title: string;
  tab: Tab;
  Component: ComponentType;
  /** Renders the title in place of `title`, for one that changes. */
  Title?: ComponentType;
  /** Rendered in the title bar, beside the favorite toggle. */
  Actions?: ComponentType;
  minW?: number;
  minH?: number;
};

type SavedLayout = (Placement & { i: string })[];

/**
 * Where a widget goes when neither your layout nor `rozenite-plugins/layout.json` places it, such as a
 * widget added since the default was saved: below everything else on its tab.
 */
const UNPLACED: Placement = { x: 0, y: Infinity, w: 6, h: 4 };
const NO_FAVORITES: string[] = [];

export type WidgetBoardOptions<Tab extends string> = {
  /** Keeps one panel's saved layouts and favorites apart from another's; the panel's key in the layout files. */
  namespace: string;
  widgets: WidgetDefinition<Tab>[];
  /** The layout the panel opens with when Metro doesn't serve one. */
  defaultLayout?: LayoutDocument | null;
};

class WidgetBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[rozenite panel] widget crashed', error, info.componentStack);
  }

  render() {
    if (this.state.error) {
      return (
        <div className="p-3">
          <Text tone="danger">{`This widget crashed: ${this.state.error.message}`}</Text>
        </div>
      );
    }
    return this.props.children;
  }
}

type FieldSizes = { useHeight: (field: string) => number | undefined; save: (field: string, height: number) => void };
const FieldSizesContext = createContext<FieldSizes | null>(null);

/**
 * Keeps a resizable field's height in the panel layout, so dragging it to a new size lasts across reloads and goes
 * with Reset layout and Save as default. `field` names it within its widget. Put `ref` and `style` on the element.
 */
export function useSavedFieldHeight<T extends HTMLElement>(field: string) {
  const sizes = useContext(FieldSizesContext);
  const height = sizes?.useHeight(field);
  const ref = useRef<T>(null);
  useEffect(() => {
    const element = ref.current;
    if (!element || !sizes) return undefined;
    let last = element.offsetHeight;
    const observer = new ResizeObserver(() => {
      const next = element.offsetHeight;
      // Zero while the widget is hidden, not a size anyone chose.
      if (next === 0 || next === last) return;
      last = next;
      sizes.save(field, next);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [sizes, field]);
  return { ref, style: height ? { height } : undefined };
}

function useSize<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  useEffect(() => {
    const element = ref.current;
    if (!element) return undefined;
    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      setSize((current) => (current.width === width && current.height === height ? current : { width, height }));
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return { ref, ...size };
}

/**
 * A panel's widgets, its favorites, and a grid per tab sized to the panel, so a tab's default layout fits
 * without scrolling. Every widget drags by its title bar and resizes from its edges; where each sits is
 * saved per tab, and the `OVERVIEW` tab shows the favorites.
 */
export function createWidgetBoard<Tab extends string>({ namespace, widgets, defaultLayout }: WidgetBoardOptions<Tab>) {
  const byId: Record<string, WidgetDefinition<Tab>> = Object.fromEntries(widgets.map((widget) => [widget.id, widget]));
  const persistence = createLayoutPersistence(namespace, defaultLayout);

  // Your override wins, then the team default.
  const effectiveFavorites = () => persistence.user.getSnapshot().favorites ?? persistence.defaults.getSnapshot()?.favorites ?? NO_FAVORITES;
  const savedLayout = (tab: string): SavedLayout | null => persistence.user.getSnapshot().tabs[tab] ?? persistence.defaults.getSnapshot()?.tabs[tab] ?? null;

  /** Re-renders on any change to either layer, and answers where your changes are kept. */
  const useLayers = (): LayoutStorage => {
    useStore(persistence.user);
    useStore(persistence.defaults);
    return useStore(persistence.storage);
  };

  const useFavorites = () => {
    useLayers();
    return effectiveFavorites();
  };

  const toggleFavorite = (id: string) => {
    const current = effectiveFavorites();
    persistence.updateUser((document) => ({ ...document, favorites: current.includes(id) ? current.filter((favorite) => favorite !== id) : [...current, id] }));
  };

  const sizeKey = (widgetId: string, field: string) => `${widgetId}:${field}`;
  const widgetIdsOn = (tab: string) => new Set(tab === OVERVIEW ? effectiveFavorites() : widgets.filter((widget) => widget.tab === tab).map((widget) => widget.id));
  /** Your field heights in the widgets on `tab`. */
  const sizesOn = (tab: string) => {
    const ids = widgetIdsOn(tab);
    return Object.fromEntries(Object.entries(persistence.user.getSnapshot().sizes ?? {}).filter(([key]) => ids.has(key.slice(0, key.indexOf(':')))));
  };

  const fieldSizesFor = (widgetId: string): FieldSizes => ({
    useHeight: (field) => {
      useLayers();
      const key = sizeKey(widgetId, field);
      return persistence.user.getSnapshot().sizes?.[key] ?? persistence.defaults.getSnapshot()?.sizes?.[key];
    },
    save: (field, height) => {
      if (persistence.storage.getSnapshot() === 'loading') return;
      const key = sizeKey(widgetId, field);
      const rounded = Math.round(height);
      if ((persistence.user.getSnapshot().sizes?.[key] ?? persistence.defaults.getSnapshot()?.sizes?.[key]) === rounded) return;
      persistence.updateUser((document) => {
        const sizes = { ...document.sizes };
        if (persistence.defaults.getSnapshot()?.sizes?.[key] === rounded) delete sizes[key];
        else sizes[key] = rounded;
        return { ...document, sizes: Object.keys(sizes).length ? sizes : undefined };
      });
    },
  });

  /** Drops your override of `tab` and its widgets' field heights, so it shows the team default again; on the `OVERVIEW` tab, the favorites too. */
  const resetLayout = (tab: string) => {
    const ids = widgetIdsOn(tab);
    persistence.updateUser((document) => {
      delete document.tabs[tab];
      if (tab === OVERVIEW) delete document.favorites;
      const sizes = Object.fromEntries(Object.entries(document.sizes ?? {}).filter(([key]) => !ids.has(key.slice(0, key.indexOf(':')))));
      return { ...document, sizes: Object.keys(sizes).length ? sizes : undefined };
    });
  };

  const hasOverride = (tab: string) => {
    const { tabs, favorites } = persistence.user.getSnapshot();
    return tabs[tab] != null || (tab === OVERVIEW && favorites != null) || Object.keys(sizesOn(tab)).length > 0;
  };

  /** Whether `tab` differs from the team default, and so has something Save as default would write. */
  const useCanSaveAsDefault = (tab: string) => useLayers() === 'disk' && hasOverride(tab);

  /** Makes your arrangement of `tab` the team default in `layout.json`, then drops the override it no longer needs. */
  const saveAsDefault = async (tab: string) => {
    if (!hasOverride(tab)) return;
    const items = savedLayout(tab) ?? [];
    const sizes = sizesOn(tab);
    await persistence.saveDefault(tab, items, tab === OVERVIEW ? effectiveFavorites() : undefined, Object.keys(sizes).length ? sizes : undefined);
    resetLayout(tab);
  };

  const onLayoutChange = (tab: string, shown: readonly LayoutItem[], next: readonly LayoutItem[]) => {
    const items = next.map(({ i, x, y, w, h }) => ({ i, x, y, w, h }));
    // The grid reports its layout as it mounts too; only a change from what it was given is yours.
    if (persistence.storage.getSnapshot() === 'loading' || sameLayout(items, shown)) return;
    const teamDefault = persistence.defaults.getSnapshot()?.tabs[tab];
    persistence.updateUser((document) => {
      if (teamDefault && sameLayout(items, teamDefault)) delete document.tabs[tab];
      else document.tabs[tab] = items;
      return document;
    });
  };

  const resolveLayout = (tab: string, shown: WidgetDefinition<Tab>[], saved: SavedLayout | null): LayoutItem[] => {
    const savedById = new Map((saved ?? []).map((item) => [item.i, item]));
    const defaultById = new Map((persistence.defaults.getSnapshot()?.tabs[tab] ?? []).map((item) => [item.i, item]));
    return shown.map((widget) => {
      const placement = savedById.get(widget.id) ?? defaultById.get(widget.id) ?? UNPLACED;
      return { i: widget.id, x: placement.x, y: placement.y, w: placement.w, h: placement.h, minW: widget.minW ?? 2, minH: widget.minH ?? 2 };
    });
  };

  function FavoriteToggle({ id }: { id: string }) {
    const favorite = useFavorites().includes(id);
    return (
      <button
        type="button"
        className={`widget-no-drag text-sm leading-none ${favorite ? 'text-warning' : 'text-muted-foreground hover:text-foreground'}`}
        title={favorite ? 'Remove from favorites' : 'Add to favorites'}
        aria-label={favorite ? 'Remove from favorites' : 'Add to favorites'}
        aria-pressed={favorite}
        onClick={() => toggleFavorite(id)}
      >
        {favorite ? '★' : '☆'}
      </button>
    );
  }

  function WidgetFrame({ widget }: { widget: WidgetDefinition<Tab> }) {
    const { Component: Body, Actions, Title } = widget;
    const fieldSizes = useMemo(() => fieldSizesFor(widget.id), [widget.id]);
    return (
      <div className="flex h-full min-h-0 flex-col overflow-hidden border border-border bg-card text-card-foreground">
        <div className="widget-handle flex h-8 shrink-0 cursor-grab items-center gap-2 border-b border-border px-2 select-none active:cursor-grabbing">
          <span className="text-muted-foreground" aria-hidden>
            ⠿
          </span>
          <Text variant="caption" className="truncate font-medium">
            {Title ? <Title /> : widget.title}
          </Text>
          <div className="widget-no-drag ml-auto flex min-w-0 shrink-0 items-center gap-2">
            {Actions && <Actions />}
            <FavoriteToggle id={widget.id} />
          </div>
        </div>
        <div className="flex min-h-0 flex-1 flex-col overflow-auto">
          <WidgetBoundary>
            <FieldSizesContext.Provider value={fieldSizes}>
              <Body />
            </FieldSizesContext.Provider>
          </WidgetBoundary>
        </div>
      </div>
    );
  }

  function Dashboard({ tab }: { tab: Tab | typeof OVERVIEW }) {
    const storage = useLayers();
    const favorites = effectiveFavorites();
    const saved = savedLayout(tab);
    const { ref, width, height } = useSize<HTMLDivElement>();
    const overview = tab === OVERVIEW;

    const shown = useMemo(
      () => (overview ? favorites.map((id) => byId[id]).filter((widget) => !!widget) : widgets.filter((widget) => widget.tab === tab)),
      [overview, tab, favorites],
    );
    const layout = useMemo(() => resolveLayout(tab, shown, saved), [tab, shown, saved]);
    const rowHeight = Math.max(MIN_ROW_HEIGHT, Math.floor((height - GAP * (GRID_ROWS + 1)) / GRID_ROWS));

    return (
      <div ref={ref} className="min-h-0 flex-1 overflow-auto">
        {overview && shown.length === 0 && <EmptyState title="No favorites yet" description="Star a widget on any tab with ☆ to pin it here." />}
        {width > 0 && shown.length > 0 && storage !== 'loading' && (
          <GridLayout
            width={width}
            layout={layout}
            gridConfig={{ cols: GRID_COLUMNS, rowHeight, margin: [GAP, GAP], containerPadding: [GAP, GAP], maxRows: overview ? Infinity : GRID_ROWS }}
            dragConfig={{ handle: '.widget-handle', cancel: '.widget-no-drag' }}
            resizeConfig={{ handles: ['se', 'e', 's'] }}
            onLayoutChange={(next) => onLayoutChange(tab, layout, next)}
          >
            {shown.map((widget) => (
              <div key={widget.id}>
                <WidgetFrame widget={widget} />
              </div>
            ))}
          </GridLayout>
        )}
      </div>
    );
  }

  return { Dashboard, useFavorites, resetLayout, toggleFavorite, saveAsDefault, useCanSaveAsDefault };
}
