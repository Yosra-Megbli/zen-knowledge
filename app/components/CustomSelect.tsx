"use client";

import { useState, useRef, useEffect, useId } from "react";
import { ChevronDown, Check } from "lucide-react";

export interface SelectOption {
  value: string;
  label: string;
}

interface CustomSelectProps {
  value: string;
  onChange: (value: string) => void;
  options: SelectOption[];
  id?: string;
  className?: string;
  required?: boolean;
}

/**
 * CustomSelect — menu déroulant stylé noir + lime, cohérent avec l'identité
 * visuelle du projet.
 *
 * Comportement identique aux <select> natifs qu'il remplace :
 *  - mêmes valeurs, mêmes onChange
 *  - Se ferme au clic extérieur et à la touche Échap
 *  - Accessible clavier : Tab pour focus, Entrée/Espace pour ouvrir,
 *    Flèches Haut/Bas pour naviguer, Entrée pour sélectionner
 */
export function CustomSelect({
  value,
  onChange,
  options,
  id,
  className = "",
  required,
}: CustomSelectProps) {
  const [open, setOpen] = useState(false);
  const [highlighted, setHighlighted] = useState<number>(-1);
  const containerRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const fallbackId = useId();
  const triggerId = id ?? fallbackId;

  const selectedOption = options.find((o) => o.value === value);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  // Scroll highlighted item into view
  useEffect(() => {
    if (!open || highlighted < 0) return;
    const li = listRef.current?.children[highlighted] as HTMLElement | undefined;
    li?.scrollIntoView({ block: "nearest" });
  }, [highlighted, open]);

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Escape") {
      setOpen(false);
      return;
    }
    if (!open) {
      if (e.key === "Enter" || e.key === " " || e.key === "ArrowDown") {
        e.preventDefault();
        setOpen(true);
        const idx = options.findIndex((o) => o.value === value);
        setHighlighted(idx >= 0 ? idx : 0);
      }
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlighted((h) => Math.min(h + 1, options.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlighted((h) => Math.max(h - 1, 0));
    } else if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      if (highlighted >= 0 && highlighted < options.length) {
        onChange(options[highlighted].value);
        setOpen(false);
      }
    }
  }

  return (
    <div ref={containerRef} className={`relative ${className}`}>
      {/* Trigger button */}
      <button
        id={triggerId}
        type="button"
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={`${triggerId}-listbox`}
        aria-required={required}
        onClick={() => {
          const next = !open;
          setOpen(next);
          if (next) {
            const idx = options.findIndex((o) => o.value === value);
            setHighlighted(idx >= 0 ? idx : 0);
          }
        }}
        onKeyDown={handleKeyDown}
        className="w-full flex items-center justify-between gap-2 border border-ink-100 rounded-lg px-3 py-2 text-sm bg-white text-left focus:outline-none focus:ring-2 focus:ring-lime-400 transition-colors hover:border-lime-400"
      >
        <span className={selectedOption ? "text-ink-900" : "text-ink-400"}>
          {selectedOption?.label ?? "—"}
        </span>
        <ChevronDown
          size={15}
          strokeWidth={2}
          className={`shrink-0 text-ink-400 transition-transform ${open ? "rotate-180" : ""}`}
        />
      </button>

      {/* Dropdown */}
      {open && (
        <ul
          ref={listRef}
          id={`${triggerId}-listbox`}
          role="listbox"
          aria-activedescendant={highlighted >= 0 ? `${triggerId}-opt-${highlighted}` : undefined}
          className="absolute z-50 mt-1 w-full bg-white border border-ink-200 rounded-xl shadow-lg max-h-64 overflow-y-auto py-1"
        >
          {options.map((opt, idx) => {
            const isSelected = opt.value === value;
            const isHighlighted = idx === highlighted;
            return (
              <li
                key={opt.value}
                id={`${triggerId}-opt-${idx}`}
                role="option"
                aria-selected={isSelected}
                onMouseEnter={() => setHighlighted(idx)}
                onClick={() => {
                  onChange(opt.value);
                  setOpen(false);
                }}
                className={`flex items-center justify-between px-3 py-2 text-sm cursor-pointer transition-colors select-none ${
                  isHighlighted
                    ? "bg-lime-50 text-ink-900"
                    : isSelected
                    ? "bg-lime-100 text-lime-800"
                    : "text-ink-700 hover:bg-lime-50"
                }`}
              >
                <span>{opt.label}</span>
                {isSelected && <Check size={13} strokeWidth={2.5} className="text-lime-600 shrink-0" />}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
