import { NextRequest, NextResponse } from "next/server";

// Single shared-password gate for the whole dashboard (Next 16 `proxy`, formerly
// `middleware`). Set DASHBOARD_PASSWORD in the env to enable it. If it's unset
// the gate is disabled (so local dev / first deploy isn't locked out). All
// webhooks live on Supabase (separate domain), so gating every Next route is safe.

const COOKIE = "dash_auth";
const TOKEN_MSG = "sarthak-dashboard-v1";

// Deterministic cookie token = HMAC-SHA256(password, TOKEN_MSG). Changing the
// password invalidates every existing session.
async function tokenFor(password: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(TOKEN_MSG));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function proxy(req: NextRequest) {
  const password = process.env.DASHBOARD_PASSWORD ?? "";
  if (!password) return NextResponse.next(); // gate disabled until a password is set

  const { pathname } = req.nextUrl;
  // The login page + its endpoints must stay reachable while logged out.
  if (pathname === "/login" || pathname === "/api/login" || pathname === "/api/logout") {
    return NextResponse.next();
  }

  // The dialer tick must stay reachable by the Vercel cron (no cookie). Vercel
  // sends `Authorization: Bearer ${CRON_SECRET}` when that env var is set.
  if (pathname === "/api/voice/process") {
    const cronSecret = process.env.CRON_SECRET ?? "";
    const auth = req.headers.get("authorization") ?? "";
    if (cronSecret && timingSafeEqual(auth, `Bearer ${cronSecret}`)) {
      return NextResponse.next();
    }
  }

  const cookie = req.cookies.get(COOKIE)?.value ?? "";
  const ok = cookie.length > 0 && timingSafeEqual(cookie, await tokenFor(password));
  if (ok) return NextResponse.next();

  // API calls get a clean 401; pages bounce to /login (preserving the target).
  if (pathname.startsWith("/api/")) {
    return new NextResponse(JSON.stringify({ error: "unauthorized" }), {
      status: 401,
      headers: { "content-type": "application/json" },
    });
  }
  const url = req.nextUrl.clone();
  url.pathname = "/login";
  url.search = "";
  url.searchParams.set("next", pathname + (req.nextUrl.search || ""));
  return NextResponse.redirect(url);
}

export const config = {
  // Run on everything except Next internals and static asset files.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|jpeg|svg|gif|ico|webp|woff2?)$).*)"],
};
