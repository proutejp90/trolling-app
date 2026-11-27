"use client";

import { useId } from "react";

interface Option<T extends string> { value: T; label: string }

/** A row of touch-sized radio buttons. The checked one is marked by a filled dot and weight, not color alone. */
export function Choice<T extends string>({ legend, hint, options, value, onChange }: {
  legend: string; hint?: string; options: readonly Option<T>[]; value: T | null; onChange: (v: T) => void;
}) {
  const name = useId();
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="text-t3">{legend}</legend>
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
              <span aria-hidden="true" className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-full border ${checked ? "border-accent-text" : "border-border-strong"}`}>
                {checked ? <span className="h-2 w-2 rounded-full bg-accent-text" /> : null}
              </span>
              <span className={checked ? "font-medium" : ""}>{o.label}</span>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}
