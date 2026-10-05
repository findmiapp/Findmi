"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import ChevronIcon from "@/components/ChevronIcon";

export interface EventFormSection {
  id: string;
  label: string;
  content: ReactNode;
}

/** Admin Event editor — section navigation for the ONE existing Event form
 * (not a wizard). Every section's fields stay mounted inside the same
 * <form>, so Save always submits everything:
 *   - mobile: a sticky row of section chips + an accordion (one section
 *     open at a time; collapsed sections are only hidden with CSS);
 *   - desktop (lg): every section stays expanded; the chips jump to it.
 * If the browser blocks Save on an invalid field inside a collapsed
 * section, that section opens and the field's message is shown. */
export default function EventFormSections({ sections, initialId }: { sections: EventFormSection[]; initialId?: string }) {
  const [active, setActive] = useState<string | null>(initialId ?? sections[0]?.id ?? null);
  const rootRef = useRef<HTMLDivElement>(null);

  function scrollToSection(id: string) {
    requestAnimationFrame(() => {
      document.getElementById(`event-section-${id}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }

  function go(id: string) {
    setActive(id);
    scrollToSection(id);
  }

  useEffect(() => {
    const form = rootRef.current?.closest("form");
    if (!form) return;
    function onInvalid(e: Event) {
      const field = e.target as HTMLElement & { reportValidity?: () => boolean };
      const id = field.closest("[data-event-section]")?.getAttribute("data-event-section");
      if (!id) return;
      setActive(id);
      // Wait for the section to render visible, then show the browser's
      // own message on the field.
      setTimeout(() => {
        field.scrollIntoView({ behavior: "smooth", block: "center" });
        field.reportValidity?.();
      }, 60);
    }
    form.addEventListener("invalid", onInvalid, true);
    return () => form.removeEventListener("invalid", onInvalid, true);
  }, []);

  return (
    <div ref={rootRef} className="flex flex-col gap-4">
      <nav
        aria-label="Event editor sections"
        className="sticky top-14 z-20 -mx-4 border-b border-black/[0.06] bg-paper/95 px-4 py-2 backdrop-blur sm:mx-0 sm:rounded-2xl sm:border sm:px-2 lg:top-0"
      >
        <div className="flex gap-1.5 overflow-x-auto [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {sections.map((s) => {
            const current = active === s.id;
            return (
              <button
                key={s.id}
                type="button"
                onClick={() => go(s.id)}
                aria-current={current ? "true" : undefined}
                className={`shrink-0 whitespace-nowrap rounded-full px-3 py-1.5 text-xs font-semibold transition ${
                  current ? "bg-ink text-white" : "border border-black/10 bg-white text-ink/70 hover:border-black/20 hover:text-ink"
                }`}
              >
                {s.label}
              </button>
            );
          })}
        </div>
      </nav>

      {sections.map((s) => {
        const open = active === s.id;
        return (
          <section
            key={s.id}
            id={`event-section-${s.id}`}
            data-event-section={s.id}
            className="scroll-mt-32 rounded-2xl border border-black/10 bg-white lg:scroll-mt-20"
          >
            <button
              type="button"
              onClick={() => setActive(open ? null : s.id)}
              aria-expanded={open}
              aria-controls={`event-section-body-${s.id}`}
              className="flex w-full items-center justify-between gap-3 px-4 py-3.5 text-left lg:pointer-events-none"
            >
              <h2 className="font-display text-base font-semibold tracking-tight text-ink">{s.label}</h2>
              <ChevronIcon
                direction="down"
                className={`h-4 w-4 shrink-0 text-ink/40 transition-transform lg:hidden ${open ? "rotate-180" : ""}`}
              />
            </button>
            <div
              id={`event-section-body-${s.id}`}
              className={`${open ? "flex" : "hidden"} flex-col gap-5 border-t border-black/[0.06] px-4 pb-4 pt-4 lg:flex`}
            >
              {s.content}
            </div>
          </section>
        );
      })}
    </div>
  );
}
