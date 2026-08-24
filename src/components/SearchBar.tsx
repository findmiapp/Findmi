"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

// Homepage-only, single-field search — routes into the existing
// /businesses search results page (its own `q` param already drives
// searchBusinesses()), so this doesn't introduce a second search
// architecture, just a shorter entry point into the existing one.
export default function SearchBar() {
  const router = useRouter();
  const [q, setQ] = useState("");

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const params = new URLSearchParams();
    if (q.trim()) params.set("q", q.trim());
    router.push(`/businesses${params.toString() ? `?${params.toString()}` : ""}`);
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="flex w-full items-center gap-2 rounded-full border border-black/10 bg-white py-2.5 pl-4 pr-1.5 shadow-sm transition focus-within:border-ink/25"
    >
      <SearchGlyph />
      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        type="text"
        placeholder="Search businesses, events, products..."
        className="w-full bg-transparent text-sm text-ink placeholder:text-ink/40 focus:outline-none"
      />
      <button
        type="submit"
        aria-label="Search"
        className="flex shrink-0 items-center justify-center rounded-full bg-findmi px-4 py-2 text-xs font-bold uppercase tracking-wide text-white transition hover:bg-findmi-600"
      >
        Search
      </button>
    </form>
  );
}

function SearchGlyph() {
  return (
    <svg viewBox="0 0 24 24" fill="none" className="h-4 w-4 shrink-0 text-ink/40">
      <circle cx="10.5" cy="10.5" r="6.5" stroke="currentColor" strokeWidth="1.8" />
      <path d="M20 20l-4.5-4.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}
