"use client";

import { createContext, useContext, useState } from "react";
import { slugify } from "@/lib/slug";

const inputClass =
  "w-full rounded-xl border border-black/10 bg-white px-3.5 py-2.5 text-base text-ink placeholder:text-ink/35 focus:border-ink/30 focus:outline-none";

/** Same Name -> URL Slug behavior as NameSlugFields (live-follow on CREATE
 * until the slug is edited by hand; never auto-changes an established slug
 * on EDIT; server re-normalizes either way), split into a provider plus two
 * independently-placed inputs so a form can show Name prominently and keep
 * the Slug in a secondary/advanced section. Both inputs are always rendered
 * (server-side too, with their real values), so the slug posts exactly as
 * before even inside a collapsed <details>. */
const SlugContext = createContext<{
  slug: string;
  followName: (name: string) => void;
  editSlug: (slug: string) => void;
} | null>(null);

export function LinkedNameSlugProvider({
  isNew,
  defaultSlug,
  children,
}: {
  isNew: boolean;
  defaultSlug?: string | null;
  children: React.ReactNode;
}) {
  const [slug, setSlug] = useState(defaultSlug ?? "");
  const [slugLocked, setSlugLocked] = useState(!isNew);
  return (
    <SlugContext.Provider
      value={{
        slug,
        followName: (name) => {
          if (!slugLocked) setSlug(slugify(name));
        },
        editSlug: (value) => {
          setSlugLocked(true);
          setSlug(value);
        },
      }}
    >
      {children}
    </SlugContext.Provider>
  );
}

function useSlugContext() {
  const ctx = useContext(SlugContext);
  if (!ctx) throw new Error("LinkedName/LinkedSlug must be inside LinkedNameSlugProvider");
  return ctx;
}

export function LinkedNameInput({
  label,
  name = "name",
  defaultValue,
  placeholder,
}: {
  label: string;
  name?: string;
  defaultValue?: string | null;
  placeholder?: string;
}) {
  const { followName } = useSlugContext();
  return (
    <label className="block">
      <span className="mb-1.5 block text-sm font-semibold text-ink">{label}</span>
      <input
        type="text"
        name={name}
        defaultValue={defaultValue ?? ""}
        placeholder={placeholder}
        required
        onChange={(e) => followName(e.target.value)}
        className={`${inputClass} text-lg font-medium`}
      />
    </label>
  );
}

export function LinkedSlugInput({ label = "URL Slug", name = "slug", hint }: { label?: string; name?: string; hint?: string }) {
  const { slug, editSlug } = useSlugContext();
  return (
    <label className="block">
      <span className="mb-1.5 block text-sm font-medium text-ink">{label}</span>
      <input type="text" name={name} value={slug} onChange={(e) => editSlug(e.target.value)} className={inputClass} />
      <span className="mt-1 block text-xs text-ink/45">
        {hint ?? "Auto-generated from the name. Edit only if you need a specific URL."}
      </span>
    </label>
  );
}
