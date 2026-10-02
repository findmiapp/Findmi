"use client";

import { createBrowserClient } from "@supabase/ssr";

// Journal Photo Upload V3 — the browser-side Supabase client, used ONLY to
// upload a photo directly to Storage via a server-issued signed upload URL
// (see authorizeJournalPhotoUploadBatch/uploadToSignedUrl in the Journal
// actions module). This client needs no authenticated session of its own
// for that call: per Supabase's own storage-js docs, uploadToSignedUrl
// requires zero storage.objects RLS permissions — the signed token itself
// (minted server-side, only after the server has already verified the
// caller owns the target Journal entry) is the real authorization. No new
// Storage RLS policy exists or is needed because of this file.
//
// Kept separate from src/lib/supabase/server.ts (Server Components/Actions,
// cookie-based) and src/lib/supabase.ts (server-side anon reads) — neither
// of those is safe or meaningful to import from a "use client" file.
let cached: ReturnType<typeof createBrowserClient> | null = null;

export function getBrowserSupabase() {
  if (cached) return cached;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return null;
  cached = createBrowserClient(url, key);
  return cached;
}
