/**
 * Controls an app describes as data, for a panel to render without UI code of its own: tabs of sections, each a list
 * of flags, toggles, choices, text, forms, actions, info rows and JSON. A change goes back to the app through
 * `apply`, and the same descriptions serve agent tools. An app can render them in an in-app menu too.
 *
 * Pure TypeScript, so the app's bundle can import it.
 */

/** A developer override that forces a flag on or off, or leaves it to the rollout. */
export type FlagState = 'default' | 'on' | 'off';

export type Tone = 'neutral' | 'warning' | 'danger';

type ControlBase = {
  id: string;
  label: string;
  description?: string;
  /** A short tag beside the label, e.g. `↻ reload` for a value read once at launch. */
  badge?: string;
  /** Turns a control off, saying why. */
  disabledReason?: string;
  /** Asked before applying, for a change that restarts or quits the app or loses data. */
  confirm?: string;
};

export type FlagControl = ControlBase & { kind: 'flag'; state: FlagState; resolved: boolean };
export type ToggleControl = ControlBase & { kind: 'toggle'; value: boolean };
/** `confirm` is asked before picking this option, for one that quits the app or loses data. `footer` is a card's bottom line. */
export type ChoiceOption = { value: string; label: string; description?: string; footer?: string; confirm?: string };
/**
 * One of `options`; with `defaultLabel`, `null` means "no override", shown with what the app would pick. A short list shows
 * every option at once and a long one opens a menu; `display: 'menu'` always opens a menu. `display: 'cards'` draws each
 * option as a card with its description and footer, and `failed` marks the selected card as a switch that didn't take.
 */
export type ChoiceControl = ControlBase & {
  kind: 'choice';
  value: string | null;
  options: ChoiceOption[];
  defaultLabel?: string;
  display?: 'cards' | 'menu';
  failed?: boolean;
};

/** The most options, counting the default, a choice shows at once before it opens a menu instead. */
export const INLINE_CHOICE_LIMIT = 12;

export function choiceShowsInline(control: ChoiceControl): boolean {
  return control.display !== 'menu' && control.options.length + (control.defaultLabel ? 1 : 0) <= INLINE_CHOICE_LIMIT;
}
export type TextControl = ControlBase & { kind: 'text'; value: string; placeholder?: string; multiline?: boolean };
/**
 * A button. Actions sit together above the section's rows; with `display: 'row'`, it is a row of its own showing the label
 * and description, with a button reading `buttonLabel` at the end.
 */
export type ActionControl = ControlBase & { kind: 'action'; tone?: Tone; display?: 'row'; buttonLabel?: string };
/**
 * A read-only value. With `inspectable`, the row opens to show a larger value the app reads only when asked
 * (the section's `inspect`); `fraction`, from 0 to 1, draws the row's share of a whole.
 */
export type InfoControl = ControlBase & { kind: 'info'; value: string; inspectable?: boolean; fraction?: number };
/** A value to inspect; with `editable`, applying a new JSON string replaces it and `null` clears the override. */
export type JsonControl = ControlBase & { kind: 'json'; value: unknown; editable?: boolean; overridden?: boolean };
export type FormField = { id: string; label: string; placeholder?: string; multiline?: boolean; value?: string };
/** Fields submitted together, such as a deep link's params: applying takes them as JSON text of `{ [field id]: string }`. */
export type FormControl = ControlBase & { kind: 'form'; fields: FormField[]; submitLabel?: string };

export type Control = FlagControl | ToggleControl | ChoiceControl | TextControl | ActionControl | InfoControl | JsonControl | FormControl;

/** What applying a control takes: a flag's state, a toggle's boolean, a choice or text, JSON text, or nothing for an action. */
export type ControlValue = FlagState | boolean | string | null;

/** What to ask before applying `value` to `control`, if anything: the control's own `confirm`, or the chosen option's. */
/** Whether an action sits above the section's rows rather than in a row of its own. */
export function isToolbarAction(control: Control): control is ActionControl {
  return control.kind === 'action' && control.display !== 'row';
}

export function confirmationFor(control: Control, value: ControlValue): string | undefined {
  if (control.confirm) return control.confirm;
  if (control.kind === 'choice') return control.options.find((option) => option.value === value)?.confirm;
  return undefined;
}

export type SectionSnapshot = {
  id: string;
  title: string;
  description?: string;
  /** Lists long enough to want a search box. */
  searchable?: boolean;
  controls: Control[];
};

/** A tab: its sections, in order. */
export type TabSnapshot = { id: string; title: string; sections: SectionSnapshot[] };

/** The tabs, in order, each with its sections' ids. */
export type ControlTabs = { id: string; title: string; sectionIds: string[] }[];

/** What applying returned: a message to show, if any. */
export type ApplyResult = { message?: string };

/** The calls a plugin serving controls answers, beside its own. */
export type ControlsMethods = {
  sections: () => Promise<SectionSnapshot[]>;
  /** `restart` restarts the app once the value is applied, for a value read only at launch. */
  apply: (params: { sectionId: string; controlId: string; value: ControlValue; restart?: boolean }) => Promise<ApplyResult>;
  /** An inspectable info row's value, as JSON text. */
  inspect: (params: { sectionId: string; controlId: string }) => Promise<{ json: string }>;
};

/** What the app pushes while a panel is attached, beside its own events. */
export type ControlsEventMap = {
  /** A section whose values changed, as JSON text of a `SectionSnapshot`. */
  'controls:section': { json: string };
};
