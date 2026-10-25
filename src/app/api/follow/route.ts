import { NextResponse } from "next/server";

// Legacy guest email follow (pre-account). No Findmi screen calls this
// route any more: following is account-based (/api/account/follow).
// Trust & Privacy Phase 2A stops it from accepting new email addresses
// from the public internet. The legacy table and its existing rows are
// left exactly as they are (nothing is deleted or migrated here).
export async function POST() {
  return NextResponse.json({ error: "This follow method is no longer available. Sign in to follow on Findmi." }, { status: 410 });
}
