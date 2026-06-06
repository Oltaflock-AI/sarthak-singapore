import { NextRequest, NextResponse } from "next/server";

// Verifies the shared password and, on success, sets the session cookie the
// proxy checks. Token = HMAC-SHA256(password, TOKEN_MSG) — same derivation as
// proxy.ts, so changing DASHBOARD_PASSWORD invalidates all sessions.

const COOKIE = "dash_auth";
const TOKEN_MSG = "sarthak-dashboard-v1";

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

function safeNext(raw: string): string {
  // Only allow same-origin relative paths to avoid open-redirect.
  return raw.startsWith("/") && !raw.startsWith("//") ? raw : "/";
}

export async function POST(req: NextRequest) {
  const password = process.env.DASHBOARD_PASSWORD ?? "";
  const form = await req.formData().catch(() => null);
  const entered = String(form?.get("password") ?? "");
  const next = safeNext(String(form?.get("next") ?? "/"));

  const valid = password.length > 0 && timingSafeEqual(entered, password);
  if (!valid) {
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    url.search = "";
    url.searchParams.set("error", "1");
    url.searchParams.set("next", next);
    return NextResponse.redirect(url, 303);
  }

  const url = req.nextUrl.clone();
  url.pathname = next;
  url.search = "";
  const res = NextResponse.redirect(url, 303);
  res.cookies.set(COOKIE, await tokenFor(password), {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 30, // 30 days
  });
  return res;
}
