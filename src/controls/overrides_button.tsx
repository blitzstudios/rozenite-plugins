import { useMemo, useState } from 'react';
import { Badge, Button, Column, Dialog, Row, Text, useToast } from '@rozenite/ui';
import { useStore } from '../store';
import { overridesIn, type Override } from './overrides';
import { useControls } from './context';

function useOverrides(): Override[] {
  const sections = useStore(useControls().sections);
  return useMemo(() => Object.values(sections).flatMap(overridesIn), [sections]);
}

function useReset() {
  const { call } = useControls();
  const toast = useToast();
  return (overrides: Override[]) =>
    overrides
      .reduce<Promise<unknown>>((previous, { section, control, reset }) => previous.then(() => call('apply', { sectionId: section.id, controlId: control.id, value: reset })), Promise.resolve())
      .catch((error: unknown) => toast.add({ title: 'Could not reset', description: error instanceof Error ? error.message : String(error), type: 'error' }));
}

/** The header's count of overrides, which opens the list of them. */
export function OverridesButton() {
  const overrides = useOverrides();
  const reset = useReset();
  const [open, setOpen] = useState(false);
  const bySection = useMemo(() => {
    const groups = new Map<string, Override[]>();
    overrides.forEach((override) => groups.set(override.section.id, [...(groups.get(override.section.id) ?? []), override]));
    return Array.from(groups.values());
  }, [overrides]);

  if (!overrides.length) return null;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Button size="sm" variant="soft" tone="info" onClick={() => setOpen(true)} title="Show what is overridden on this device">
        {`${overrides.length} ${overrides.length === 1 ? 'override' : 'overrides'}`}
      </Button>
      <Dialog.Content className="max-h-[80vh] w-[36rem] max-w-[90vw]">
        <Dialog.Header>
          <Dialog.Title>Overrides on this device</Dialog.Title>
          <Dialog.Description>Flags, experiments and configs set away from what the app would do by itself.</Dialog.Description>
        </Dialog.Header>
        <Column gap={3} className="min-h-0 overflow-auto">
          {bySection.map((group) => (
            <Column key={group[0].section.id} gap={1}>
              <Text variant="caption" tone="neutral" className="font-medium uppercase">
                {group[0].section.title}
              </Text>
              {group.map((override) => (
                <Row key={override.control.id} gap={2} align="center" className="border-b border-border py-1 last:border-b-0">
                  <Text variant="code" className="min-w-0 flex-1 truncate" title={override.control.label}>
                    {override.control.label}
                  </Text>
                  <Badge tone="info" size="sm" className="shrink-0">
                    {override.value}
                  </Badge>
                  <Button size="sm" variant="ghost" tone="neutral" className="shrink-0" onClick={() => reset([override])}>
                    Reset
                  </Button>
                </Row>
              ))}
            </Column>
          ))}
        </Column>
        <Dialog.Footer>
          <Button variant="soft" tone="danger" onClick={() => reset(overrides)}>
            Reset all
          </Button>
          <Button variant="ghost" tone="neutral" onClick={() => setOpen(false)}>
            Close
          </Button>
        </Dialog.Footer>
      </Dialog.Content>
    </Dialog>
  );
}
