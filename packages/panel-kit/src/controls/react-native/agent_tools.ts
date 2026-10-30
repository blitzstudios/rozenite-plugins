import type { AgentToolEntry } from '../../agent_tools';
import { overridesIn } from '../overrides';
import { confirmationFor, type Control, type ControlValue } from '../protocol';
import type { ControlOperations } from './serve';

const SEARCH_LIMIT = 100;

const text = (value: unknown) => (typeof value === 'string' ? value : undefined);
const bool = (value: unknown) => value === true;
const matches = (query: string | undefined, ...fields: (string | undefined)[]) => {
  if (!query) return true;
  const needle = query.toLowerCase();
  return fields.some((field) => field?.toLowerCase().includes(needle));
};

const describeControl = (control: Control) => {
  if (control.kind === 'flag') return 'value: "default" | "on" | "off"';
  if (control.kind === 'toggle') return 'value: true | false';
  if (control.kind === 'choice') return `value: one of the option values without a disabledReason${control.defaultLabel ? ', or null for no override' : ''}`;
  if (control.kind === 'text') return 'value: a string';
  if (control.kind === 'json') return control.editable ? 'value: JSON text to override, or null to clear the override' : 'read only';
  if (control.kind === 'action') return 'value: null (runs the action)';
  if (control.kind === 'form') return `value: JSON text of an object with the fields ${control.fields.map((field) => `"${field.id}"`).join(', ')} as strings`;
  if (control.kind === 'info' && control.inspectable) return 'read only; inspect-control reads the value behind it';
  return 'read only';
};

/**
 * The tools an agent reads and changes the controls with. `subject` names them in the descriptions, e.g. "the
 * developer menu".
 */
export function controlsAgentTools(ops: ControlOperations, { subject = "the app's controls" }: { subject?: string } = {}): AgentToolEntry[] {
  return [
    {
      tool: {
        name: 'list-tabs',
        description: `The tabs of ${subject}, in order, each with its sections' ids and titles. Start here; the other tools take a section id.`,
        inputSchema: { type: 'object', properties: {} },
        readOnly: true,
        idempotent: true,
      },
      handler: () => {
        const titles = new Map(ops.sections().map((section) => [section.id, section.title]));
        return ops.tabs().map((tab) => ({ id: tab.id, title: tab.title, sections: tab.sectionIds.map((id) => ({ id, title: titles.get(id) ?? id })) }));
      },
    },
    {
      tool: {
        name: 'get-section',
        description:
          `One section of ${subject} with every control and its current value: flags (state default/on/off, and what the rollout resolved to), toggles, choices with their options, text, actions, forms, info and JSON. A control or a choice option with disabledReason cannot be applied; one with confirm (or a choice option with confirm) restarts the app, quits it or loses data.`,
        inputSchema: { type: 'object', properties: { sectionId: { type: 'string' } }, required: ['sectionId'] },
        readOnly: true,
        idempotent: true,
      },
      handler: (args) => {
        const section = ops.section(String(args.sectionId));
        return { ...section, controls: section.controls.map((control) => ({ ...control, accepts: describeControl(control) })) };
      },
    },
    {
      tool: {
        name: 'search-controls',
        description: 'Finds controls across every section by label or id, e.g. a feature gate, experiment or config by name. Returns each with its section id and current value.',
        inputSchema: {
          type: 'object',
          properties: {
            match: { type: 'string', description: 'Text in the control label or id, case-insensitively.' },
            kind: { type: 'string', enum: ['flag', 'toggle', 'choice', 'text', 'action', 'info', 'json', 'form'] },
          },
          required: ['match'],
        },
        readOnly: true,
        idempotent: true,
      },
      handler: (args) => {
        const query = text(args.match);
        const kind = text(args.kind);
        return ops
          .sections()
          .flatMap((section) =>
            section.controls
              .filter((control) => (!kind || control.kind === kind) && matches(query, control.label, control.id))
              .map((control) => ({ sectionId: section.id, sectionTitle: section.title, ...control, accepts: describeControl(control) })),
          )
          .slice(0, SEARCH_LIMIT);
      },
    },
    {
      tool: {
        name: 'list-overrides',
        description: 'Every developer override in effect on this device: forced feature flags and gates, chosen experiment groups, overridden configs. Each with the value reset-overrides would put back.',
        inputSchema: { type: 'object', properties: {} },
        readOnly: true,
        idempotent: true,
      },
      handler: () =>
        ops
          .sections()
          .flatMap(overridesIn)
          .map(({ section, control, value, reset }) => ({ sectionId: section.id, sectionTitle: section.title, controlId: control.id, label: control.label, value, reset })),
    },
    {
      tool: {
        name: 'apply-control',
        description:
          `Changes one control, exactly as tapping it in ${subject} does: force a flag on or off, pick an experiment group, switch environment, run an action. get-section or search-controls give the ids and what each accepts. A control with confirm (restarts or quits the app, loses data) needs confirmed: true, after asking the user.`,
        inputSchema: {
          type: 'object',
          properties: {
            sectionId: { type: 'string' },
            controlId: { type: 'string' },
            value: { type: ['string', 'boolean', 'null'], description: 'What the control takes; see accepts.' },
            confirmed: { type: 'boolean', description: 'Required for a control that has confirm.' },
          },
          required: ['sectionId', 'controlId'],
        },
      },
      handler: async (args) => {
        const sectionId = String(args.sectionId);
        const controlId = String(args.controlId);
        const control = ops.section(sectionId).controls.find((candidate) => candidate.id === controlId);
        if (!control) throw new Error(`No control ${controlId} in ${sectionId}`);
        if (control.disabledReason) throw new Error(`${control.label} is disabled: ${control.disabledReason}`);
        const value = (args.value ?? null) as ControlValue;
        const option = control.kind === 'choice' ? control.options.find((candidate) => candidate.value === value) : undefined;
        if (option?.disabledReason) throw new Error(`${option.label} can't be picked: ${option.disabledReason}`);
        const confirmation = confirmationFor(control, value);
        if (confirmation && !bool(args.confirmed)) throw new Error(`${control.label} needs confirmed: true. ${confirmation}`);
        const result = await ops.apply(sectionId, controlId, value);
        const after = ops.section(sectionId).controls.find((candidate) => candidate.id === controlId);
        return { ...result, control: after ?? null };
      },
    },
    {
      tool: {
        name: 'inspect-control',
        description:
          'Reads the value behind an info control with inspectable: true, such as a storage key, a Redux slice or a React Query entry. These are read on request because they can be large.',
        inputSchema: { type: 'object', properties: { sectionId: { type: 'string' }, controlId: { type: 'string' } }, required: ['sectionId', 'controlId'] },
        readOnly: true,
        idempotent: true,
      },
      handler: (args) => ops.inspect(String(args.sectionId), String(args.controlId)),
    },
    {
      tool: {
        name: 'reset-overrides',
        description: "Puts developer overrides back to what the app would do by itself: every one, or only one section's.",
        inputSchema: { type: 'object', properties: { sectionId: { type: 'string', description: 'Only this section.' } } },
        destructive: true,
        idempotent: true,
      },
      handler: async (args) => {
        const sectionId = text(args.sectionId);
        const overrides = (sectionId ? [ops.section(sectionId)] : ops.sections()).flatMap(overridesIn);
        await overrides.reduce<Promise<unknown>>((previous, { section, control, reset }) => previous.then(() => ops.apply(section.id, control.id, reset)), Promise.resolve());
        return { reset: overrides.map(({ section, control }) => ({ sectionId: section.id, controlId: control.id, label: control.label })) };
      },
    },
  ];
}
