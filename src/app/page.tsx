// The practice view.
//
// Loads settings server-side so the start screen renders with the real domain and
// mode state rather than flashing defaults first.

import PracticeSession from "@/components/PracticeSession";
import { DEFAULT_ENABLED_DOMAINS } from "@/lib/satConfig";
import { loadSettings } from "@/lib/stats";
import type { AppSettings } from "@/types";

// Settings change during a session, so this page must never be statically cached.
export const dynamic = "force-dynamic";

export default async function PracticePage() {
  let settings: AppSettings;

  try {
    settings = await loadSettings();
  } catch (error) {
    // A missing env var or an unapplied migration lands here. Fall back to
    // defaults so the page still renders and the real error surfaces on the first
    // API call, where it can be shown properly.
    console.error(
      "Could not load settings for the practice page:",
      error instanceof Error ? error.message : error
    );
    settings = {
      enabledDomains: DEFAULT_ENABLED_DOMAINS,
      simMode: false,
      timerEnabled: false,
    };
  }

  return <PracticeSession initialSettings={settings} />;
}
