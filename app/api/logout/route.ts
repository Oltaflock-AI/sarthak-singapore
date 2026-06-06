import { NextRequest, NextResponse } from "next/server";

const COOKIE = "dash_auth";

// Clears the session cookie and returns to the login screen.
export async function POST(req: NextRequest) {
  const url = req.nextUrl.clone();
  url.pathname = "/login";
  url.search = "";
  const res = NextResponse.redirect(url, 303);
  res.cookies.set(COOKIE, "", { httpOnly: true, secure: true, sameSite: "lax", path: "/", maxAge: 0 });
  return res;
}
