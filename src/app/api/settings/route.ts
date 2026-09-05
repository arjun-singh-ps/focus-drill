// GET/PUT /api/settings — the practice preferences behind the settings drawer:
// which domains are in rotation, test-day simulation, and the timer.

import { NextResponse } from "next/server";
import { DOMAINS } from "@/lib/satConfig";
import { loadSettings, saveSettings } from "@/lib/stats";
import type { AppSettings } from "@/types";

const VALID_DOMAIN_KEYS = new Set(DOMAINS.map((d) => d.key));

export async function GET() {
  try {
    return NextResponse.json(await loadSettings());
  } catch (error) {
    console.error(
      "Could not load settings:",
      error instanceof Error ? error.message : error
    );
    return NextResponse.json({ error: "Could not load settings." }, { status: 502 });
  }
}

export async function PUT(request: Request) {
  let body: Partial<AppSettings>;

  try {
    body = (await request.json()) as Partial<AppSettings>;
  } catch {
    return NextResponse.json({ error: "Expected a JSON body." }, { status: 400 });
  }

  const { enabledDomains, simMode, timerEnabled } = body;

  if (!Array.isArray(enabledDomains) || enabledDomains.length === 0) {
    return NextResponse.json(
      { error: "Keep at least one domain switched on." },
      { status: 400 }
    );
  }

  // Reject unknown keys rather than storing them — an unknown domain would
  // silently contribute no subskills and quietly shrink the rotation.
  const unknown = enabledDomains.filter((key) => !VALID_DOMAIN_KEYS.has(key));
  if (unknown.length > 0) {
    return NextResponse.json(
      { error: `Unknown domain(s): ${unknown.join(", ")}` },
      { status: 400 }
    );
  }

  if (typeof simMode !== "boolean" || typeof timerEnabled !== "boolean") {
    return NextResponse.json(
      { error: "simMode and timerEnabled must be true or false." },
      { status: 400 }
    );
  }

  try {
    await saveSettings({ enabledDomains, simMode, timerEnabled });
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error(
      "Could not save settings:",
      error instanceof Error ? error.message : error
    );
    return NextResponse.json({ error: "Could not save settings." }, { status: 502 });
  }
}
