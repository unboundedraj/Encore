"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import type { CitySummary } from "shared";
import { persistCity, POPULAR_CITIES } from "@/lib/city";

interface CitySelectorProps {
  current: string;
  /** Cities that actually have shows, from the API. Empty falls back to the static list. */
  cities: CitySummary[];
}

/**
 * The city picker in the header.
 *
 * Selecting writes the cookie and calls router.refresh(), which re-runs every
 * server component on the page against the new city -- so the catalog and
 * showtimes update without a full navigation and without this component
 * needing to know what any of them render.
 */
export function CitySelector({ current, cities }: CitySelectorProps) {
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState<string | null>(null);
  const router = useRouter();
  const panelRef = useRef<HTMLDivElement>(null);

  // A dropdown that cannot be dismissed by clicking away or pressing Escape
  // feels broken, and both are cheap.
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const options: { city: string; showCount: number | null }[] =
    cities.length > 0
      ? cities.map((entry) => ({ city: entry.city, showCount: entry.show_count }))
      : POPULAR_CITIES.map((city) => ({ city, showCount: null }));

  function choose(city: string) {
    setPending(city);
    persistCity(city);
    setOpen(false);
    router.refresh();
    // The refresh is a server round trip; clearing on a timer rather than
    // awaiting it keeps the label from being stuck if the refresh is slow.
    setTimeout(() => setPending(null), 1200);
  }

  return (
    <div className="relative" ref={panelRef}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="listbox"
        className="flex items-center gap-1.5 rounded-md px-2 py-1.5 text-sm text-white/90 transition-colors hover:bg-white/10"
      >
        <svg viewBox="0 0 24 24" className="h-4 w-4 shrink-0" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
          <path d="M12 21s7-5.686 7-11a7 7 0 1 0-14 0c0 5.314 7 11 7 11Z" />
          <circle cx="12" cy="10" r="2.5" />
        </svg>
        <span className="max-w-[9rem] truncate font-medium">{pending ?? current}</span>
        <svg viewBox="0 0 24 24" className={`h-3.5 w-3.5 transition-transform ${open ? "rotate-180" : ""}`} fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true">
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>

      {open ? (
        <div
          role="listbox"
          aria-label="Select your city"
          className="absolute right-0 z-50 mt-2 w-72 overflow-hidden rounded-lg bg-surface shadow-2xl ring-1 ring-black/10"
        >
          <p className="border-b border-hairline px-4 py-3 text-xs font-semibold uppercase tracking-wider text-muted">
            Select your city
          </p>
          <ul className="max-h-80 overflow-y-auto py-1">
            {options.map(({ city, showCount }) => {
              const active = city === current;
              return (
                <li key={city}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={active}
                    onClick={() => choose(city)}
                    className={`flex w-full items-center justify-between gap-3 px-4 py-2.5 text-left text-sm transition-colors hover:bg-background ${
                      active ? "font-semibold text-accent" : "text-foreground"
                    }`}
                  >
                    <span>{city}</span>
                    {showCount !== null ? (
                      <span className="shrink-0 text-xs text-muted">
                        {showCount} show{showCount === 1 ? "" : "s"}
                      </span>
                    ) : null}
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
