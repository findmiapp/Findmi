import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

// Temporary diagnostic route — safe to hit from a browser, never returns
// secret values (only whether they're set, and Supabase's own error text).
// Remove once the live-data issue is confirmed fixed.
export async function GET() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  const result: Record<string, unknown> = {
    hasUrl: Boolean(url),
    hasKey: Boolean(key),
    urlPreview: url ? `${url.slice(0, 24)}…` : null,
    keyLength: key ? key.length : null,
  };

  if (url && key) {
    try {
      const supabase = createClient(url, key, { auth: { persistSession: false } });
      const { data, error, count } = await supabase
        .from("businesses")
        .select("name", { count: "exact" })
        .limit(3);

      result.queryOk = !error;
      result.error = error?.message ?? null;
      result.errorCode = (error as { code?: string } | null)?.code ?? null;
      result.businessCount = count;
      result.sampleNames = data?.map((b) => b.name) ?? [];
    } catch (e) {
      result.threw = e instanceof Error ? e.message : String(e);
    }
  }

  return NextResponse.json(result);
}
