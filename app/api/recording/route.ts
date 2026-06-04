import { NextRequest, NextResponse } from "next/server";

// Streams a Conversational AI call recording from ElevenLabs, keeping the API
// key server-side. ElevenLabs does NOT include audio in the post-call webhook;
// it's fetched on demand by conversation_id (which is our calls.call_id).
//   GET /api/recording?conversation_id=conv_xxx
export async function GET(req: NextRequest) {
  const conversationId = req.nextUrl.searchParams.get("conversation_id");
  if (!conversationId) {
    return NextResponse.json({ error: "conversation_id required" }, { status: 400 });
  }

  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "ELEVENLABS_API_KEY not configured" }, { status: 503 });
  }

  const upstream = await fetch(
    `https://api.elevenlabs.io/v1/convai/conversations/${encodeURIComponent(conversationId)}/audio`,
    { headers: { "xi-api-key": apiKey } },
  );

  if (!upstream.ok || !upstream.body) {
    const detail = await upstream.text().catch(() => "");
    return NextResponse.json(
      { error: `elevenlabs ${upstream.status}`, detail: detail.slice(0, 300) },
      { status: upstream.status === 404 ? 404 : 502 },
    );
  }

  return new NextResponse(upstream.body, {
    status: 200,
    headers: {
      "Content-Type": upstream.headers.get("content-type") ?? "audio/mpeg",
      "Cache-Control": "private, max-age=3600",
    },
  });
}
