import { useCallback, useMemo, useState, type ComponentProps } from 'react';
import {
  Badge,
  Button,
  Column,
  EmptyState,
  Input,
  JsonInspector,
  Row,
  SearchField,
  Switch,
  Text,
  Textarea,
  ToggleGroup,
  useConfirmDialog,
  useCopyToClipboard,
  useToast,
} from '@rozenite/ui';
import { useStore } from '../store';
import { useSavedFieldHeight } from '../widgets';
import { confirmationFor, isToolbarAction, type ChoiceControl, type ChoiceIndicator, type Control, type ControlValue, type FlagControl, type FlagState, type FormControl, type InfoControl, type JsonControl, type TextControl } from './protocol';
import { useControls } from './context';
import { overridesIn } from './overrides';

const DEFAULT_CHOICE = '__default__';

/** Applies a control's new value; resolves whether it was applied, rather than cancelled or refused. */
type Apply = (value: ControlValue, restart?: boolean) => Promise<boolean>;

const normalize = (value: string) =>
  value
    .toLowerCase()
    .replace(/[\s_]+/g, ' ')
    .trim();

function useApply(sectionId: string) {
  const { call } = useControls();
  const toast = useToast();
  const confirm = useConfirmDialog();
  return useCallback(
    async (control: Control, value: ControlValue, restart?: boolean): Promise<boolean> => {
      const confirmation = confirmationFor(control, value);
      if (confirmation && !(await confirm({ title: control.label, description: confirmation, tone: 'warning', confirmLabel: 'Continue' }))) return false;
      try {
        const result = await call('apply', { sectionId, controlId: control.id, value, restart });
        if (result.message) toast.add({ title: result.message, type: 'success' });
        return true;
      } catch (error) {
        const message = error instanceof Error ? error.message.replace(/^apply failed: /, '') : String(error);
        toast.add({ title: `${control.label}: not applied`, description: message, type: 'error' });
        return false;
      }
    },
    [call, confirm, sectionId, toast],
  );
}

function Label({ control }: { control: Control }) {
  return (
    <Column gap={0} className="min-w-40 flex-1">
      <Row gap={2} align="center" className="min-w-0">
        <Text className="truncate font-medium" tone={control.disabledReason ? 'neutral' : undefined} title={control.label}>
          {control.label}
        </Text>
        {control.badge && (
          <Badge tone="warning" size="sm" className="shrink-0">
            {control.badge}
          </Badge>
        )}
      </Row>
      {(control.disabledReason || control.description) && (
        <Text variant="caption" tone="neutral">
          {control.disabledReason ?? control.description}
        </Text>
      )}
    </Column>
  );
}

function FlagInput({ control, onApply }: { control: FlagControl; onApply: (value: ControlValue) => void }) {
  return (
    <ToggleGroup<FlagState> size="sm" value={[control.state]} onValueChange={(value) => value[0] && value[0] !== control.state && onApply(value[0])}>
      <ToggleGroup.Item value="default" title="Leave it to the rollout">
        <span className={control.resolved ? 'text-success' : 'text-danger'}>{`Default [${control.resolved ? 'ON' : 'OFF'}]`}</span>
      </ToggleGroup.Item>
      <ToggleGroup.Item value="on">ON</ToggleGroup.Item>
      <ToggleGroup.Item value="off">OFF</ToggleGroup.Item>
    </ToggleGroup>
  );
}

function ChoiceInput({ control, onApply }: { control: ChoiceControl; onApply: (value: ControlValue) => void }) {
  const selected = control.options.find((option) => option.value === control.value);
  return (
    <Column gap={1} className="w-64 max-w-[50%] shrink-0">
      <select
        className="h-7 w-full border border-input bg-background px-2 text-sm text-foreground"
        value={control.value ?? DEFAULT_CHOICE}
        disabled={!!control.disabledReason}
        onChange={(event) => onApply(event.target.value === DEFAULT_CHOICE ? null : event.target.value)}
      >
        {control.defaultLabel && <option value={DEFAULT_CHOICE}>{control.defaultLabel}</option>}
        {control.options.map((option) => (
          <option key={option.value} value={option.value} disabled={!!option.disabledReason} title={option.disabledReason}>
            {option.label}
          </option>
        ))}
      </select>
      {selected?.description && (
        <Text variant="caption" tone="neutral">
          {selected.description}
        </Text>
      )}
    </Column>
  );
}

/** A textarea whose dragged height is kept in the panel layout under `field`. */
function SavedTextarea({ field, className, ...props }: ComponentProps<typeof Textarea> & { field: string }) {
  const { ref, style } = useSavedFieldHeight<HTMLTextAreaElement>(field);
  return <Textarea {...props} ref={ref} style={style} className={`resize-y ${className ?? ''}`} />;
}

function TextInput({ control, onApply }: { control: TextControl; onApply: (value: ControlValue) => void }) {
  const [draft, setDraft] = useState(control.value);
  const commit = () => draft !== control.value && onApply(draft);
  return control.multiline ? (
    <SavedTextarea
      field={`text:${control.id}`}
      size="sm"
      className="w-64 max-w-[50%]"
      value={draft}
      placeholder={control.placeholder}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
    />
  ) : (
    <Input
      size="sm"
      className="w-40"
      value={draft}
      placeholder={control.placeholder}
      disabled={!!control.disabledReason}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => e.key === 'Enter' && commit()}
    />
  );
}

function JsonRow({ control, onApply }: { control: JsonControl; onApply: Apply }) {
  const [draft, setDraft] = useState<string | null>(null);
  const applyDraft = (restart?: boolean) => draft != null && onApply(draft, restart).then((applied) => applied && setDraft(null));
  return (
    <Column gap={2} className={`border-b border-border py-2 last:border-b-0 ${control.overridden ? 'border-l-2 border-l-info pl-2' : ''}`}>
      <Row gap={2} align="start">
        <Label control={control} />
        {control.editable && (
          <Row gap={1} className="shrink-0">
            {draft == null ? (
              <>
                <Button size="sm" variant="soft" onClick={() => setDraft(JSON.stringify(control.value, null, 2))}>
                  Edit override
                </Button>
                {control.overridden && (
                  <Button size="sm" variant="ghost" tone="neutral" onClick={() => onApply(null)}>
                    Clear override
                  </Button>
                )}
              </>
            ) : (
              <>
                <Button size="sm" onClick={() => applyDraft()}>
                  Apply
                </Button>
                <Button size="sm" variant="soft" onClick={() => applyDraft(true)}>
                  Apply & restart
                </Button>
                <Button size="sm" variant="ghost" tone="neutral" onClick={() => setDraft(null)}>
                  Cancel
                </Button>
              </>
            )}
          </Row>
        )}
      </Row>
      {draft != null ? (
        <SavedTextarea field={`json:${control.id}`} size="sm" className="min-h-40 font-mono text-xs" value={draft} onChange={(e) => setDraft(e.target.value)} spellCheck={false} />
      ) : (
        <JsonInspector data={control.value ?? null} defaultExpandedDepth={1} />
      )}
    </Column>
  );
}

type Inspected = { state: 'loading' } | { state: 'loaded'; value: unknown } | { state: 'failed'; message: string };

function InfoRow({ sectionId, control }: { sectionId: string; control: InfoControl }) {
  const { call } = useControls();
  const { copy, copied } = useCopyToClipboard();
  const [inspected, setInspected] = useState<Inspected | null>(null);
  const toggle = () => {
    if (inspected) {
      setInspected(null);
      return;
    }
    setInspected({ state: 'loading' });
    call('inspect', { sectionId, controlId: control.id }).then(
      ({ json }) => setInspected({ state: 'loaded', value: JSON.parse(json) }),
      (error) => setInspected({ state: 'failed', message: error instanceof Error ? error.message : String(error) }),
    );
  };
  return (
    <Column gap={1} className="min-w-0 border-b border-border py-1 last:border-b-0">
      <Row gap={2} align="baseline" className="relative isolate min-w-0">
        {control.fraction != null && <div className="pointer-events-none absolute inset-y-0 left-0 -z-10 rounded-sm bg-info/15" style={{ width: `${Math.min(1, control.fraction) * 100}%` }} />}
        <Text variant="caption" tone="neutral" className="w-40 shrink-0 truncate" title={control.description ?? control.label}>
          {control.label}
        </Text>
        <Text variant="code" className="min-w-0 flex-1 break-all" title={control.value}>
          {control.value}
        </Text>
        {control.inspectable && (
          <button type="button" className="shrink-0 text-xs text-muted-foreground hover:text-foreground" onClick={toggle}>
            {inspected ? 'Close' : 'Inspect'}
          </button>
        )}
        <button type="button" className="shrink-0 text-xs text-muted-foreground hover:text-foreground" onClick={() => copy(inspected?.state === 'loaded' ? JSON.stringify(inspected.value, null, 2) : control.value)}>
          {copied ? 'Copied' : 'Copy'}
        </button>
      </Row>
      {inspected?.state === 'loading' && <Text tone="neutral">Reading…</Text>}
      {inspected?.state === 'failed' && <Text tone="danger">{inspected.message}</Text>}
      {inspected?.state === 'loaded' && <JsonInspector data={inspected.value ?? null} defaultExpandedDepth={1} />}
    </Column>
  );
}

function FormRow({ control, onApply }: { control: FormControl; onApply: Apply }) {
  const [draft, setDraft] = useState<Record<string, string>>(() => Object.fromEntries(control.fields.map((field) => [field.id, field.value ?? ''])));
  return (
    <Column gap={1} className="min-w-0 border-b border-border py-1.5 last:border-b-0">
      <Row gap={2} align="center" wrap>
        <Label control={control} />
        <Button size="sm" variant="soft" className="ml-auto shrink-0" disabled={!!control.disabledReason} onClick={() => onApply(JSON.stringify(draft))}>
          {control.submitLabel ?? 'Go'}
        </Button>
      </Row>
      {control.fields.map((field) =>
        field.multiline ? (
          <SavedTextarea
            key={field.id}
            field={`form:${control.id}.${field.id}`}
            size="sm"
            rows={12}
            className="min-h-20 font-mono text-xs"
            aria-label={field.label}
            placeholder={field.placeholder ?? field.label}
            value={draft[field.id]}
            onChange={(e) => setDraft((current) => ({ ...current, [field.id]: e.target.value }))}
            spellCheck={false}
          />
        ) : (
          <Input
            key={field.id}
            size="sm"
            aria-label={field.label}
            placeholder={field.placeholder ?? field.label}
            value={draft[field.id]}
            onChange={(e) => setDraft((current) => ({ ...current, [field.id]: e.target.value }))}
            onKeyDown={(e) => e.key === 'Enter' && onApply(JSON.stringify(draft))}
          />
        ),
      )}
    </Column>
  );
}

const INDICATOR_GLYPHS: Record<ChoiceIndicator['kind'], { glyph: string; color: string }> = {
  progress: { glyph: '⏳', color: 'inherit' },
  success: { glyph: '✓', color: '#22c55e' },
  error: { glyph: '✕', color: '#ef4444' },
  warning: { glyph: '⚠', color: '#f59e0b' },
  neutral: { glyph: '⊘', color: '#9ca3af' },
};

/** A card's corner icons, each explained on hover. */
function Indicators({ indicators }: { indicators: ChoiceIndicator[] }) {
  return (
    <span className="absolute right-2 top-2 flex gap-1 text-xs">
      {indicators.map((indicator) => (
        <span
          key={`${indicator.kind}:${indicator.title}`}
          role="img"
          aria-label={`${indicator.title}: ${indicator.text}`}
          title={`${indicator.title}: ${indicator.text}`}
          style={{ color: INDICATOR_GLYPHS[indicator.kind].color }}
        >
          {INDICATOR_GLYPHS[indicator.kind].glyph}
        </span>
      ))}
    </span>
  );
}

/** Each option as a card with its description, footer and corner icons. A disabled option is struck through. */
function ChoiceCards({ control, onApply }: { control: ChoiceControl; onApply: (value: ControlValue) => void }) {
  return (
    <Row gap={2} className="overflow-x-auto pb-1">
      {control.options.map((option) => {
        const selected = option.value === control.value;
        const border = selected ? (control.failed ? 'border-red-500 bg-red-500/15' : 'border-emerald-400 bg-emerald-400/15') : 'border-border';
        const struck = option.disabledReason ? 'line-through' : '';
        return (
          <button
            key={option.value}
            type="button"
            disabled={!!control.disabledReason || !!option.disabledReason}
            onClick={() => !selected && onApply(option.value)}
            className={`relative flex h-36 w-40 shrink-0 flex-col items-start gap-1 rounded-lg border p-3 text-left disabled:opacity-60 ${border}`}
          >
            {!!option.indicators?.length && <Indicators indicators={option.indicators} />}
            <Text className={`pr-10 font-semibold ${struck}`}>{option.label}</Text>
            {option.description && (
              <Text variant="caption" tone="neutral" className={`line-clamp-4 ${struck}`}>
                {option.description}
              </Text>
            )}
            {option.footer && (
              <Text variant="caption" tone="neutral" className="mt-auto whitespace-pre-line text-[10px]">
                {option.footer}
              </Text>
            )}
          </button>
        );
      })}
    </Row>
  );
}

function ControlRow({ sectionId, control, onApply }: { sectionId: string; control: Control; onApply: Apply }) {
  if (control.kind === 'info') return <InfoRow sectionId={sectionId} control={control} />;
  if (control.kind === 'choice' && control.display === 'cards') {
    return (
      <Column gap={2} className="min-w-0 border-b border-border py-1.5 last:border-b-0">
        <Label control={control} />
        <ChoiceCards control={control} onApply={onApply} />
      </Column>
    );
  }
  if (control.kind === 'json') return <JsonRow control={control} onApply={onApply} />;
  if (control.kind === 'form') return <FormRow control={control} onApply={onApply} />;
  return (
    <Row gap={3} align="center" wrap className="min-w-0 border-b border-border py-1.5 last:border-b-0">
      <Label control={control} />
      <div className="ml-auto shrink-0">
        {control.kind === 'flag' && <FlagInput control={control} onApply={onApply} />}
        {control.kind === 'toggle' && <Switch aria-label={control.label} checked={control.value} disabled={!!control.disabledReason} onCheckedChange={(checked) => onApply(checked)} />}
        {control.kind === 'choice' && <ChoiceInput control={control} onApply={onApply} />}
        {control.kind === 'text' && <TextInput key={control.value} control={control} onApply={onApply} />}
        {control.kind === 'action' && (
          <Button size="sm" variant="soft" tone={control.tone === 'danger' ? 'danger' : control.tone === 'warning' ? 'warning' : 'primary'} disabled={!!control.disabledReason} onClick={() => onApply(null)}>
            {control.buttonLabel ?? 'Run'}
          </Button>
        )}
      </div>
    </Row>
  );
}

/** One section of the developer menu, rendered from the same description the in-app menu renders. */
export function SectionWidget({ sectionId }: { sectionId: string }) {
  const section = useStore(useControls().sections)[sectionId];
  const apply = useApply(sectionId);
  const [query, setQuery] = useState('');

  const { actions, rows } = useMemo(() => {
    const controls = section?.controls ?? [];
    const needle = normalize(query);
    return {
      actions: controls.filter(isToolbarAction),
      rows: controls.filter((control) => !isToolbarAction(control) && (!needle || normalize(control.label).includes(needle))),
    };
  }, [section, query]);

  if (!section) return <EmptyState title="Loading…" />;

  return (
    <Column fill className="h-full">
      {(section.description || section.searchable || actions.length > 0) && (
        <Column gap={2} className="shrink-0 border-b border-border p-2">
          {section.description && (
            <Text variant="caption" tone="neutral">
              {section.description}
            </Text>
          )}
          {(section.searchable || actions.length > 0) && (
            <Row gap={2} align="center" wrap>
              {section.searchable && <SearchField size="sm" className="w-56" placeholder="Filter" value={query} onChange={(e) => setQuery(e.target.value)} onClear={() => setQuery('')} />}
              {actions.map((control) => (
                <Button
                  key={control.id}
                  size="sm"
                  variant="soft"
                  tone={control.kind === 'action' && control.tone === 'danger' ? 'danger' : control.kind === 'action' && control.tone === 'warning' ? 'warning' : 'primary'}
                  disabled={!!control.disabledReason}
                  title={control.description ?? control.disabledReason}
                  onClick={() => apply(control, null)}
                >
                  {control.label}
                </Button>
              ))}
            </Row>
          )}
        </Column>
      )}
      <div className="min-h-0 flex-1 overflow-auto px-3 py-1">
        {rows.length === 0 && query ? <Text tone="neutral">Nothing matches</Text> : rows.map((control) => <ControlRow key={control.id} sectionId={sectionId} control={control} onApply={(value, restart) => apply(control, value, restart)} />)}
      </div>
    </Column>
  );
}

export function SectionCount({ sectionId }: { sectionId: string }) {
  const overridden = overridesIn(useStore(useControls().sections)[sectionId]).length;
  if (!overridden) return null;
  return (
    <Badge tone="info" size="sm" title="Overridden on this device">
      {`${overridden} overridden`}
    </Badge>
  );
}
