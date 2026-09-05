// GET /api/export — the full session log as a CSV download.
//
// For pulling four weeks of practice into a spreadsheet without going near the
// Supabase dashboard.

import { buildSessionLogCsv } from "@/lib/progress";
import { NextResponse } from "next/server";

export async function GET() {
  try {
    const csv = await buildSessionLogCsv();
    const filename = `focus-drill-${new Date().toISOString().slice(0, 10)}.csv`;

    return new Response(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filename}"`,
        // The log changes every question; a cached CSV would be quietly wrong.
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    console.error(
      "Could not export the session log:",
      error instanceof Error ? error.message : error
    );
    return NextResponse.json({ error: "Could not build the export." }, { status: 502 });
  }
}
