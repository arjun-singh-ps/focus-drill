// GET /api/progress — the data behind the /progress dashboard.
//
// Read-only and behind the same password gate as everything else.

import { NextResponse } from "next/server";
import { buildProgressData } from "@/lib/progress";

export async function GET() {
  try {
    return NextResponse.json(await buildProgressData());
  } catch (error) {
    console.error(
      "Could not build progress data:",
      error instanceof Error ? error.message : error
    );
    return NextResponse.json({ error: "Could not load progress." }, { status: 502 });
  }
}
