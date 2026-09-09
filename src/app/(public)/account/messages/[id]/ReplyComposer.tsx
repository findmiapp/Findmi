"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { sendReply } from "@/app/(public)/connect/actions";
import type { ConversationEntityType } from "@/lib/opportunities";

/** Public Messaging V1, Section 5 — the reply composer's only UI. When the
 * viewer can act as more than one party in this thread (rare — e.g. an
 * admin/staff member of both sides), a compact "Reply as" selector picks
 * which identity sends; otherwise it's implicit. router.refresh() (not a
 * full navigation) after a successful send re-runs the Server Component
 * above with fresh data, same "stay on this page, just re-render" shape
 * every other account page already gets from revalidatePath + redirect —
 * here there's no redirect to piggyback on, so this calls refresh directly. */
export default function ReplyComposer({
  conversationId,
  parties,
}: {
  conversationId: string;
  parties: { entityType: ConversationEntityType; entityId: string | null; label: string }[];
}) {
  const router = useRouter();
  const [actingKey, setActingKey] = useState(`${parties[0].entityType}:${parties[0].entityId ?? ""}`);
  const [body, setBody] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const acting = parties.find((p) => `${p.entityType}:${p.entityId ?? ""}` === actingKey) ?? parties[0];

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const text = body.trim();
    if (!text) return;
    setSubmitting(true);
    setError(null);
    try {
      const result = await sendReply(conversationId, acting.entityType, acting.entityId, text);
      if ("error" in result) {
        setError(result.error);
      } else {
        setBody("");
        router.refresh();
      }
    } catch {
      setError("Couldn't send that message. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-2 rounded-2xl border border-black/10 bg-white p-3.5 shadow-sm">
      {parties.length > 1 && (
        <select
          value={actingKey}
          onChange={(e) => setActingKey(e.target.value)}
          className="w-fit rounded-lg border border-black/10 bg-white px-2.5 py-1.5 text-xs text-ink focus:border-ink/30 focus:outline-none"
        >
          {parties.map((p) => (
            <option key={`${p.entityType}:${p.entityId ?? ""}`} value={`${p.entityType}:${p.entityId ?? ""}`}>
              Reply as {p.label}
            </option>
          ))}
        </select>
      )}
      <textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        rows={2}
        placeholder="Write a reply…"
        className="w-full resize-none rounded-xl border border-black/10 bg-white px-3.5 py-2.5 text-sm text-ink placeholder:text-ink/35 focus:border-ink/30 focus:outline-none"
      />
      {error && <p className="text-xs text-red-600">{error}</p>}
      <button
        type="submit"
        disabled={submitting || !body.trim()}
        className="ml-auto flex h-10 items-center justify-center rounded-full bg-findmi px-5 text-xs font-bold uppercase tracking-wide text-white transition hover:bg-findmi-600 disabled:opacity-60"
      >
        {submitting ? "…" : "Send"}
      </button>
    </form>
  );
}
