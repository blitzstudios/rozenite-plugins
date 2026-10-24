import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { VirtualizedDataTable, cn, type DataTableColumn, type VirtualizedDataTableProps } from '@rozenite/ui';

/** The narrowest a column without a `size` gets before lower-priority columns are dropped to make room for it. */
const MIN_FLEX_WIDTH = 160;

export type FixedColumnsTableProps<TData> = VirtualizedDataTableProps<TData> & {
  /**
   * How much each column is worth keeping, by id, higher kept longer. While the table is too narrow for every column at
   * its `size` (or `MIN_FLEX_WIDTH` for one without), the lowest-priority column is dropped, then the next. A column
   * not listed is never dropped: give the one that identifies a row no priority.
   */
  priorities?: Record<string, number>;
};

function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const element = ref.current;
    if (!element) return undefined;
    const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return { ref, width };
}

function neededWidth<TData>(columns: DataTableColumn<TData>[]) {
  return columns.reduce((sum, column) => sum + (column.size ?? MIN_FLEX_WIDTH), 0);
}

/** `columns` less the lowest-priority ones that don't fit in `width`. */
export function fitColumns<TData>(columns: DataTableColumn<TData>[], priorities: Record<string, number> | undefined, width: number): DataTableColumn<TData>[] {
  if (!priorities || width <= 0) return columns;
  const droppable = columns.filter((column) => column.id && priorities[column.id] != null).sort((a, b) => priorities[a.id!] - priorities[b.id!]);
  return droppable.reduce((shown, column) => (neededWidth(shown) <= width ? shown : shown.filter((candidate) => candidate !== column)), columns);
}

/**
 * `VirtualizedDataTable` with columns that keep their width while it scrolls. The table lays its columns
 * out from the rows it happens to have rendered, so a long cell scrolling into view widens its column; this
 * fixes the layout instead: a column with a `size` is that many pixels wide, the rest share what is left,
 * and a cell's content truncates rather than growing it.
 */
export function FixedColumnsTable<TData>({ className, columns, priorities, ...props }: FixedColumnsTableProps<TData>) {
  const scope = `fixed-columns-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;
  const { ref, width } = useWidth<HTMLDivElement>();
  const shown = useMemo(() => fitColumns(columns, priorities, width), [columns, priorities, width]);
  const css = useMemo(
    () =>
      [
        `.${scope} { table-layout: fixed; width: 100%; }`,
        `.${scope} th, .${scope} td { overflow: hidden; }`,
        `.${scope} td > * { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }`,
        ...shown.map((column, index) => (column.size ? `.${scope} th:nth-child(${index + 1}) { width: ${column.size}px; }` : '')),
      ].join('\n'),
    [shown, scope],
  );
  return (
    <div ref={ref} className="h-full min-h-0 w-full min-w-0 flex-1">
      <style>{css}</style>
      <VirtualizedDataTable<TData> {...props} columns={shown} className={cn(scope, className)} />
    </div>
  );
}
