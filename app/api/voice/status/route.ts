import { NextRequest, NextResponse } from "next/server";
import { getLiveCallStatus } from "@/lib/elevenlabs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Live status for an in-flight call. The dialer polls this every ~2s while a
// call is active to drive the "Ringing → Connected → Ended" indicator.
// GET ?conversation_id=conv_…
export async function GET(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("conversation_id");
  if (!id) return NextResponse.json({ error: "conversation_id required" }, { status: 400 });
  try {
    const status = await getLiveCallStatus(id);
    return NextResponse.json(status);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    // 404 / not-yet-available is normal in the first second after dialing.
    return NextResponse.json({ conversation_id: id, phase: "unknown", error: msg }, { status: 200 });
  }
}
