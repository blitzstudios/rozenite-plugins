import type { Control, ControlValue, SectionSnapshot } from './protocol';

/** A control set away from what the app would do by itself: a forced flag, a chosen group, an overridden config. */
export type Override = { section: SectionSnapshot; control: Control; value: string; reset: ControlValue };

/** A control that asks first (quits the app, loses data) is left out, so resetting overrides never does that unasked. */
function overrideOf(section: SectionSnapshot, control: Control): Override | null {
  if (control.confirm || control.disabledReason) return null;
  if (control.kind === 'flag' && control.state !== 'default') return { section, control, value: control.state.toUpperCase(), reset: 'default' };
  if (control.kind === 'choice' && control.defaultLabel && control.value != null) {
    return { section, control, value: control.options.find((option) => option.value === control.value)?.label ?? control.value, reset: null };
  }
  if (control.kind === 'json' && control.overridden) return { section, control, value: 'overridden', reset: null };
  return null;
}

export const overridesIn = (section: SectionSnapshot | undefined): Override[] =>
  (section?.controls ?? []).map((control) => overrideOf(section!, control)).filter((override): override is Override => !!override);
