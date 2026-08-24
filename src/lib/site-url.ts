// Server-only public-origin resolver. Stripe Checkout Sessions require
// absolute success_url/cancel_url values — a relative path (e.g. "/cart")
// is rejected outright (400 url_invalid). This is the one place that
// resolves FindMi's public origin so every caller gets a real absolute URL.
//
// Precedence:
//   1. NEXT_PUBLIC_SITE_URL, if actually set to a non-empty value — trimmed
//      and stripped of a trailing slash. (Deliberately checked for
//      emptiness rather than just nullish: `env ?? fallback` does NOT catch
//      an env var present but set to "", which is exactly what produced
//      the relative-URL bug this file fixes.)
//   2. VERCEL_URL — auto-injected by Vercel on every deployment, so this
//      resolves correctly on the current *.vercel.app domain with zero
//      configuration, and keeps working unchanged once NEXT_PUBLIC_SITE_URL
//      is pointed at findmi.app (step 1 then takes over, no code change).
//   3. localhost, for local dev.
export function getPublicOrigin(): string {
  const configured = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  if (configured) return configured.replace(/\/+$/, "");

  const vercelUrl = process.env.VERCEL_URL?.trim();
  if (vercelUrl) return `https://${vercelUrl.replace(/\/+$/, "")}`;

  return "http://localhost:3000";
}
