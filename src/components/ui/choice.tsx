"use client";

import { Check } from "lucide-react";
import { useId, type ReactNode } from "react";

interface Option<T extends string> { value: T; label: string }

/** A row of touch-sized radio buttons. The checked one is marked by a filled dot with a check in it, and by weight, not color alone. */
export function Choice<T extends string>({ legend, tag, hint, options, value, onChange }: {
  legend: string; tag?: ReactNode; hint?: string; options: readonly Option<T>[]; value: T | null; onChange: (v: T) => void;
}) {
  const name = useId();
  return (
    <fieldset className="flex flex-col gap-2" aria-label={legend}>
      <div className="flex items-center gap-2">
        <span className="text-t3">{legend}</span>
        {tag}
      </div>
      {hint ? <p className="text-small text-fg-tertiary">{hint}</p> : null}
      <div className="grid grid-cols-2 gap-2">
        {options.map((o) => {
          const checked = o.value === value;
          return (
            <label
              key={o.value}
              className={`flex min-h-touch cursor-pointer items-center gap-2 rounded-sm border px-3 transition-colors duration-100 has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-focus ${checked ? "border-border-strong bg-accent-soft text-fg" : "border-border bg-surface-2 text-fg-secondary hover:border-border-strong"}`}
            >
              <input type="radio" name={name} value={o.value} checked={checked} onChange={() => onChange(o.value)} className="sr-only" />
              {/* The check sits inside the dot: beside it, the longer labels wrap and the form moves when one is chosen. */}
              <span aria-hidden="true" className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-full border ${checked ? "border-accent bg-accent text-accent-on" : "border-border-strong"}`}>
                {checked ? <Check size={12} strokeWidth={2.5} /> : null}
              </span>
              <span className={checked ? "font-medium" : ""}>{o.label}</span>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}
