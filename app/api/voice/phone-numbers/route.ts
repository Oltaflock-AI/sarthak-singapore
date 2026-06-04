import { NextResponse } from "next/server";
import { listPhoneNumbers } from "@/lib/elevenlabs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const numbers = await listPhoneNumbers();
    return NextResponse.json(
      numbers.map((n) => ({
        id: n.phone_number_id,
        phone_number: n.phone_number,
        label: n.label ?? null,
        provider: n.provider ?? null,
        agent: n.assigned_agent?.agent_name ?? null,
      })),
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
