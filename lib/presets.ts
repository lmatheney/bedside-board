export type Preset = {
  id: string;
  label: string;
  inner: string;
  wider: string;
};

export const PRESETS: Preset[] = [
  {
    id: "surgery_started",
    label: "Surgery started",
    inner: "Surgery started at [time]; expected about [hours] hrs",
    wider: "{name} is in a procedure today",
  },
  {
    id: "surgery_done",
    label: "Surgery done",
    inner: "Out of surgery; surgeon says [notes]",
    wider: "The procedure is done",
  },
  {
    id: "moved_icu",
    label: "Moved to ICU",
    inner: "Moved to ICU for closer monitoring because [reason]",
    wider: "Being watched closely",
  },
  {
    id: "left_icu",
    label: "Left ICU",
    inner: "Moved to [step-down / regular floor]",
    wider: "Making progress",
  },
  {
    id: "on_ventilator",
    label: "On a ventilator",
    inner: "Intubated to help {name} breathe",
    wider: "Getting extra support",
  },
  {
    id: "off_ventilator",
    label: "Off the ventilator",
    inner: "Extubated and breathing without the ventilator",
    wider: "Making progress",
  },
  {
    id: "waiting_results",
    label: "Waiting on results",
    inner: "Waiting on [test]; expect news [when]",
    wider: "No new news yet",
  },
  {
    id: "resting",
    label: "Resting",
    inner: "Resting comfortably, no changes",
    wider: "Resting",
  },
  {
    id: "visitors",
    label: "Visitors",
    inner: "Visitors [allowed / not allowed]; [hours, rules]",
    wider: "Please hold off on visits for now",
  },
  {
    id: "going_home",
    label: "Going home",
    inner: "Discharge planned for [date]",
    wider: "Heading home soon",
  },
  {
    id: "freeform",
    label: "Free-form",
    inner: "",
    wider: "",
  },
];

export function presetById(id: string | null): Preset | undefined {
  if (!id) return undefined;
  return PRESETS.find((preset) => preset.id === id);
}

export function presetLabel(id: string | null): string | null {
  return presetById(id)?.label ?? null;
}

export function draftsFor(presetId: string, patientName: string): { inner: string; wider: string } {
  const preset = presetById(presetId);
  if (!preset) return { inner: "", wider: "" };
  const fill = (template: string) => template.replaceAll("{name}", patientName);
  return { inner: fill(preset.inner), wider: fill(preset.wider) };
}
