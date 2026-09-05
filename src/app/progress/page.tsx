// The progress dashboard — the view you check without interrupting her session.
//
// Data is fetched server-side so the page arrives populated rather than empty and
// then filling in.

import ProgressDashboard from "@/components/ProgressDashboard";
import { buildProgressData } from "@/lib/progress";
import type { ProgressData } from "@/types";

// The log changes with every answered question, so never cache this page.
export const dynamic = "force-dynamic";

export default async function ProgressPage() {
  // Fetched outside any JSX-returning branch: a try/catch around a `return <X/>`
  // does not actually protect against a render error thrown by X, only against
  // the fetch above it — keeping them separate makes that true instead of implied.
  let data: ProgressData | null = null;

  try {
    data = await buildProgressData();
  } catch (error) {
    console.error(
      "Could not load the progress page:",
      error instanceof Error ? error.message : error
    );
  }

  if (!data) {
    return (
      <main className="min-h-dvh flex items-center justify-center px-6">
        <div className="max-w-sm text-center">
          <h1 className="text-lg mb-2" style={{ fontFamily: "var(--font-source-serif), Georgia, serif" }}>
            Could not load progress
          </h1>
          <p className="text-sm" style={{ color: "var(--ink-muted)" }}>
            The database did not answer. Check that both migrations in
            supabase/migrations have been run, then reload.
          </p>
        </div>
      </main>
    );
  }

  return <ProgressDashboard data={data} />;
}
