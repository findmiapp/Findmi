"use client";

import { useState } from "react";

export default function EventFollowForm({
  eventId,
  eventName,
}: {
  eventId: string;
  eventName: string;
}) {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<"idle" | "loading" | "done" | "error">("idle");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim()) return;
    setStatus("loading");

    try {
      const res = await fetch("/api/follow-event", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ eventId, email: email.trim() }),
      });
      setStatus(res.ok ? "done" : "error");
    } catch {
      setStatus("error");
    }
  }

  if (status === "done") {
    return (
      <p className="rounded-xl bg-findmi-50 px-4 py-3 text-sm font-medium text-findmi-700">
        You&rsquo;re in. We&rsquo;ll let you know about updates to {eventName}.
      </p>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-2 sm:flex-row">
      <input
        type="email"
        required
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        placeholder="you@email.com"
        className="w-full flex-1 rounded-xl border border-black/10 bg-white px-4 py-3 text-sm text-ink placeholder:text-ink/40 focus:border-ink/30 focus:outline-none"
      />
      <button
        type="submit"
        disabled={status === "loading"}
        className="shrink-0 rounded-xl bg-findmi px-4 py-2.5 text-xs font-bold uppercase tracking-wide text-white transition hover:bg-findmi-600 disabled:opacity-60"
      >
        {status === "loading" ? "Following…" : "Follow"}
      </button>
      {status === "error" && (
        <p className="text-xs text-red-600 sm:absolute">
          Something went wrong — try again in a moment.
        </p>
      )}
    </form>
  );
}
