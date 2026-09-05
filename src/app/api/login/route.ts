// POST /api/login — exchange the shared password for a signed session cookie.
//
// Public: src/proxy.ts lets this through unauthenticated, which is the whole point.

import { NextResponse } from "next/server";
import {
  createSessionToken,
  isCorrectPassword,
  SESSION_COOKIE,
  SESSION_COOKIE_OPTIONS,
} from "@/lib/session";

export async function POST(request: Request) {
  let password: unknown;

  try {
    const body = await request.json();
    password = (body as { password?: unknown })?.password;
  } catch {
    return NextResponse.json({ error: "Expected a JSON body." }, { status: 400 });
  }

  if (typeof password !== "string" || password.length === 0) {
    return NextResponse.json({ error: "Enter the password." }, { status: 400 });
  }

  try {
    if (!isCorrectPassword(password)) {
      // Deliberately vague, and no hint about length or near-misses.
      return NextResponse.json({ error: "That password is not right." }, { status: 401 });
    }

    const response = NextResponse.json({ ok: true });
    response.cookies.set(SESSION_COOKIE, await createSessionToken(), SESSION_COOKIE_OPTIONS);
    return response;
  } catch (error) {
    // A missing APP_PASSWORD / SESSION_SECRET lands here. Log the detail, tell the
    // user something actionable without leaking configuration.
    console.error("Login failed:", error instanceof Error ? error.message : error);
    return NextResponse.json(
      { error: "Login is not configured correctly on the server." },
      { status: 500 }
    );
  }
}
