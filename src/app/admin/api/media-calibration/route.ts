import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin/auth";
import { getAdminSupabase } from "@/lib/admin/supabase-admin";
import { CALIBRATION_ORIGINALS, MOMENT_PHOTO_REGISTRY_NOTE, isCalibrationExecutionEnabled, preflightCalibration, runCalibration } from "@/lib/admin/media-calibration";

// Legacy-variant CALIBRATION runner — a one-time, tightly scoped admin
// tool to validate the media_variants registry architecture
// (migration 20261007010000_media_variants_registry.sql) against real
// production bytes for exactly the 11 originals selected in the backfill
// audit, before any full referenced-media backfill is authorized. See
// lib/admin/media-calibration.ts for the full pipeline and why it's safe
// (CALIBRATION_ORIGINALS is a closed literal list — there is no code path
// here that can reach any other object).
//
// Protection: lives under /admin/api/..., so middleware's "/admin/:path*"
// matcher already gates it behind the founder admin session cookie;
// requireAdmin() below is the same second, independent layer every other
// /admin/api/* route uses (see admin/api/search/route.ts,
// admin/api/stripe-subscriptions-diagnostic/route.ts).
//
// GET  — read-only preflight: verifies all 11 originals are still
//        referenced, their source objects still exist, and prints
//        whether each already has an unexpected registry row. Writes
//        nothing, ever. Safe to call freely. Admin-only, same as POST,
//        but needs no extra flag since it never writes.
// POST — the actual write pipeline (download → generate role-required
//        sizes only → validate → upload → verify → register). TWO
//        independent gates must both be satisfied, in addition to admin
//        auth: (1) the server-side env var MEDIA_CALIBRATION_ENABLED must
//        literally equal "true" — absent, empty, or any other value fails
//        closed — so calibration can never run just because someone with
//        an admin session discovers/guesses this URL; a human has to
//        deliberately set and deploy that var first. (2) the request body
//        must be exactly {"confirm":"RUN_CALIBRATION"}, so it can't be
//        triggered by an accidental GET/empty POST/health check once the
//        flag IS on. Even then, each original is re-preflighted
//        immediately before being touched (see runCalibration) — stale
//        state blocks that one original rather than the whole batch.
//
// DELETE THIS FILE (or gate it further) once the calibration run this
// exists for has been reviewed and a go/no-go decision on the full
// backfill has been made — it is a one-time operational tool, not a
// permanent admin surface.

function unauthorized() {
  return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}

function noAdminClient() {
  return NextResponse.json({ error: "Storage/DB isn't configured on the server." }, { status: 500 });
}

/** Mandatory execution gate for POST — defaults to disabled. Must be set
 * to the exact string "true" in this deployment's environment (and
 * redeployed) before any calibration write can run; absent, "false", or
 * any other value fails closed. Independent of, and in addition to,
 * requireAdmin() and the request-body confirm phrase below. */
function calibrationDisabled() {
  return NextResponse.json(
    { error: 'Refused: calibration execution is disabled. Set MEDIA_CALIBRATION_ENABLED=true in this environment and redeploy before POST can run.' },
    { status: 403 },
  );
}

export async function GET() {
  try {
    await requireAdmin();
  } catch {
    return unauthorized();
  }
  const admin = getAdminSupabase();
  if (!admin) return noAdminClient();

  const preflight = await preflightCalibration(admin);
  return NextResponse.json({
    mode: "preflight-only (read-only, no writes)",
    originalsCount: CALIBRATION_ORIGINALS.length,
    allSafeToProcess: preflight.every((p) => p.safeToProcess),
    preflight,
    momentPhotoRegistryNote: MOMENT_PHOTO_REGISTRY_NOTE,
  });
}

export async function POST(request: Request) {
  try {
    await requireAdmin();
  } catch {
    return unauthorized();
  }
  if (!isCalibrationExecutionEnabled(process.env)) {
    return calibrationDisabled();
  }
  const admin = getAdminSupabase();
  if (!admin) return noAdminClient();

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    body = null;
  }
  const confirmed = !!body && typeof body === "object" && (body as Record<string, unknown>).confirm === "RUN_CALIBRATION";
  if (!confirmed) {
    return NextResponse.json(
      { error: 'Refused: POST body must be exactly {"confirm":"RUN_CALIBRATION"}. This endpoint writes real derivative files and registry rows for the 11 calibration originals — call GET first to review the preflight report.' },
      { status: 400 },
    );
  }

  const { preflight, results } = await runCalibration(admin);
  const totalDerivatives = results.reduce((n, r) => n + r.derivatives.filter((d) => d.verified).length, 0);
  const totalDerivativeBytes = results.reduce((n, r) => n + r.derivatives.filter((d) => d.verified).reduce((m, d) => m + d.bytes, 0), 0);
  const totalSourceBytes = results.reduce((n, r) => n + r.sourceBytes, 0);
  const registryRowsCreated = results.filter((r) => r.registered).length;
  const failures = results.filter((r) => r.error || r.partialFailure);

  return NextResponse.json({
    mode: "EXECUTED — real Storage writes and registry rows were created for verified derivatives only",
    preflight,
    results,
    summary: {
      originalsProcessed: results.length,
      totalDerivativeFiles: totalDerivatives,
      totalDerivativeBytes,
      totalSourceBytes,
      registryRowsCreated,
      failuresCount: failures.length,
      failures: failures.map((f) => ({ key: f.key, error: f.error, partialFailure: f.partialFailure })),
    },
    momentPhotoRegistryNote: MOMENT_PHOTO_REGISTRY_NOTE,
  });
}
