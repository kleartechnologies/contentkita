"use client";

import { useId } from "react";
import type * as React from "react";

import { cn } from "@/lib/utils";

const controlBase =
  "w-full rounded-[var(--radius-field)] border border-line-strong bg-surface px-3.5 py-2.5 text-[0.9375rem] text-ink placeholder:text-ink-muted transition-colors duration-150 hover:border-ink-muted/60 focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/25 disabled:cursor-not-allowed disabled:bg-sunken";

export function Label({ className, ...props }: React.ComponentProps<"label">) {
  return (
    <label
      className={cn("text-sm font-semibold text-ink", className)}
      {...props}
    />
  );
}

export function Input({ className, ...props }: React.ComponentProps<"input">) {
  return <input className={cn(controlBase, "h-11 py-0", className)} {...props} />;
}

export function Textarea({
  className,
  ...props
}: React.ComponentProps<"textarea">) {
  return (
    <textarea
      className={cn(controlBase, "min-h-24 resize-y leading-relaxed", className)}
      {...props}
    />
  );
}

export interface FieldControlProps {
  id: string;
  "aria-describedby"?: string;
}

interface FieldProps {
  label: string;
  hint?: string;
  optional?: boolean;
  children: (props: FieldControlProps) => React.ReactNode;
}

/**
 * Label + control + hint, wired together with a generated id so every control
 * in the product is labelled and described without each caller inventing ids.
 */
export function Field({ label, hint, optional, children }: FieldProps) {
  const id = useId();
  const hintId = `${id}-hint`;
  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between gap-3">
        <Label htmlFor={id}>{label}</Label>
        {optional ? (
          <span className="text-xs font-medium text-ink-muted">Pilihan</span>
        ) : null}
      </div>
      {children({ id, "aria-describedby": hint ? hintId : undefined })}
      {hint ? (
        <p id={hintId} className="text-xs leading-relaxed text-ink-muted">
          {hint}
        </p>
      ) : null}
    </div>
  );
}
