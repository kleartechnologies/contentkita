"use client";

import { Check } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * The one selection control the whole product uses.
 *
 * Cards rather than a `<select>`: on a phone a native picker hides every option
 * but one, and these choices — tone, language, where you post — are exactly the
 * ones an owner needs to compare before deciding. Each card carries a plain
 * example instead of a label they would have to interpret.
 *
 * Rendered as real radios and checkboxes underneath, so keyboard and screen
 * reader behaviour is the browser's rather than something reimplemented here.
 */

export interface Choice<T extends string> {
  value: T;
  label: string;
  hint?: string;
}

interface SingleProps<T extends string> {
  name: string;
  legend: string;
  options: readonly Choice<T>[];
  value: T;
  onChange: (value: T) => void;
  columns?: 1 | 2;
}

export function ChoiceGroup<T extends string>({
  name,
  legend,
  options,
  value,
  onChange,
  columns = 2,
}: SingleProps<T>) {
  return (
    <fieldset>
      <legend className="sr-only">{legend}</legend>
      <div className={cn("grid gap-2.5", columns === 2 && "sm:grid-cols-2")}>
        {options.map((option) => (
          <Card
            key={option.value}
            active={value === option.value}
            label={option.label}
            hint={option.hint}
          >
            <input
              type="radio"
              name={name}
              value={option.value}
              checked={value === option.value}
              onChange={() => onChange(option.value)}
              className="sr-only"
            />
          </Card>
        ))}
      </div>
    </fieldset>
  );
}

interface MultiProps<T extends string> {
  name: string;
  legend: string;
  options: readonly Choice<T>[];
  value: T[];
  onChange: (value: T[]) => void;
  columns?: 1 | 2;
  /** Below this many selections, unticking the last one is refused. */
  min?: number;
}

export function ChoiceGrid<T extends string>({
  name,
  legend,
  options,
  value,
  onChange,
  columns = 2,
  min = 1,
}: MultiProps<T>) {
  function toggle(option: T) {
    if (value.includes(option)) {
      // Refused rather than allowed-then-complained-about at submit: an empty
      // set has no sensible meaning here, and the owner finds out immediately.
      if (value.length <= min) return;
      onChange(value.filter((v) => v !== option));
    } else {
      // Kept in the catalogue's order, so the stored value does not depend on
      // the order somebody happened to tap.
      onChange(options.map((o) => o.value).filter((v) => value.includes(v) || v === option));
    }
  }

  return (
    <fieldset>
      <legend className="sr-only">{legend}</legend>
      <div className={cn("grid gap-2.5", columns === 2 && "sm:grid-cols-2")}>
        {options.map((option) => {
          const active = value.includes(option.value);
          return (
            <Card
              key={option.value}
              active={active}
              label={option.label}
              hint={option.hint}
              tick
            >
              <input
                type="checkbox"
                name={name}
                value={option.value}
                checked={active}
                onChange={() => toggle(option.value)}
                className="sr-only"
              />
            </Card>
          );
        })}
      </div>
    </fieldset>
  );
}

function Card({
  active,
  label,
  hint,
  tick,
  children,
}: {
  active: boolean;
  label: string;
  hint?: string;
  tick?: boolean;
  children: React.ReactNode;
}) {
  return (
    <label
      className={cn(
        "relative cursor-pointer rounded-[var(--radius-field)] border px-4 py-3 transition-colors",
        // The ring follows the hidden input's focus so keyboard users can see
        // where they are without a visible control to focus.
        "has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-brand/40",
        active
          ? "border-brand bg-brand-tint"
          : "border-line bg-surface hover:bg-sunken",
      )}
    >
      {children}
      <span
        className={cn(
          "block pr-6 text-sm font-bold",
          active ? "text-brand-ink" : "text-ink",
        )}
      >
        {label}
      </span>
      {hint ? (
        <span className="mt-0.5 block text-xs leading-relaxed text-ink-soft">
          {hint}
        </span>
      ) : null}
      {tick && active ? (
        <Check
          className="absolute right-3 top-3 size-4 text-brand-ink"
          aria-hidden
        />
      ) : null}
    </label>
  );
}
