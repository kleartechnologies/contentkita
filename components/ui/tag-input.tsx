"use client";

import { useState } from "react";
import { Plus, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/field";
import type { FieldControlProps } from "@/components/ui/field";

interface TagInputProps extends FieldControlProps {
  value: string[];
  onChange: (next: string[]) => void;
  placeholder?: string;
  max?: number;
}

/**
 * Free-text list entry for menu items. Enter, comma and the visible button all
 * commit a value — a phone keyboard's "return" is not something to rely on.
 */
export function TagInput({
  value,
  onChange,
  placeholder,
  max = 5,
  ...field
}: TagInputProps) {
  const [draft, setDraft] = useState("");
  const full = value.length >= max;

  function add(raw: string) {
    const cleaned = raw.trim().replace(/,+$/, "").trim();
    if (!cleaned || full) return;
    const exists = value.some(
      (v) => v.toLowerCase() === cleaned.toLowerCase(),
    );
    if (!exists) onChange([...value, cleaned]);
    setDraft("");
  }

  function remove(index: number) {
    onChange(value.filter((_, i) => i !== index));
  }

  return (
    <div className="space-y-2.5">
      <div className="flex gap-2">
        <Input
          {...field}
          value={draft}
          onChange={(e) => {
            const next = e.target.value;
            if (next.includes(",")) add(next);
            else setDraft(next);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              add(draft);
            } else if (e.key === "Backspace" && !draft && value.length) {
              remove(value.length - 1);
            }
          }}
          onBlur={() => add(draft)}
          placeholder={full ? `Cukup ${max} sudah` : placeholder}
          disabled={full}
          className="flex-1"
        />
        <Button
          type="button"
          variant="secondary"
          onClick={() => add(draft)}
          disabled={full || !draft.trim()}
          aria-label="Tambah menu"
        >
          <Plus />
          <span className="sr-only sm:not-sr-only">Tambah</span>
        </Button>
      </div>

      {value.length ? (
        <ul className="flex flex-wrap gap-2">
          {value.map((tag, i) => (
            <li key={tag}>
              <span className="inline-flex items-center gap-1 rounded-full border border-brand-line bg-brand-tint py-1 pl-3.5 pr-1 text-sm font-semibold text-brand-ink">
                {tag}
                <button
                  type="button"
                  onClick={() => remove(i)}
                  className="grid size-8 place-items-center rounded-full text-brand-ink/70 transition-colors hover:bg-brand-line hover:text-brand-ink"
                  aria-label={`Buang ${tag}`}
                >
                  <X className="size-3.5" aria-hidden />
                </button>
              </span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
