// The revision page — every attempted question, what she picked, and why.
//
// Data is fetched server-side so the first page arrives populated; filter changes
// and "load more" after that go through the client component and /api/review.

import ReviewList from "@/components/ReviewList";
import { loadReviewPage } from "@/lib/review";
import type { ReviewPage } from "@/types";

const INITIAL_LIMIT = 25;

// The log changes with every answered question, so never cache this page.
export const dynamic = "force-dynamic";

export default async function ReviewPageRoute() {
  // Fetched outside any JSX-returning branch, same reasoning as /progress: a
  // try/catch around a `return <X/>` does not protect against X's own render
  // errors, only the fetch above it.
  let initial: ReviewPage | null = null;

  try {
    initial = await loadReviewPage({
      outcome: "all",
      subskillKey: null,
      offset: 0,
      limit: INITIAL_LIMIT,
    });
  } catch (error) {
    console.error(
      "Could not load the review page:",
      error instanceof Error ? error.message : error
    );
  }

  if (!initial) {
    return (
      <main className="min-h-dvh flex items-center justify-center px-6">
        <div className="max-w-sm text-center">
          <h1 className="text-lg mb-2" style={{ fontFamily: "var(--font-source-serif), Georgia, serif" }}>
            Could not load revision
          </h1>
          <p className="text-sm" style={{ color: "var(--ink-muted)" }}>
            The database did not answer. Check that all three migrations in
            supabase/migrations have been run, then reload.
          </p>
        </div>
      </main>
    );
  }

  return <ReviewList initialItems={initial.items} initialHasMore={initial.hasMore} />;
}
