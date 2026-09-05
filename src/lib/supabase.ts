// Server-only Supabase client. Never import this from a "use client" file —
// the service-role key bypasses Row Level Security and must stay server-side.
//
// Unlike pm-ai-toolkit there is no anon-key client here at all: this app does not
// use Supabase Auth, so the service-role key is the only database credential and
// the browser never talks to Supabase directly.

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let serviceClient: SupabaseClient | null = null;

/**
 * Returns the singleton service-role Supabase client used for every server-side
 * read and write. Lazily created so importing this module does not throw at build
 * time when the env vars are absent.
 */
export function getSupabaseServiceClient(): SupabaseClient {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error(
      "NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY is not set. Add them to .env.local."
    );
  }

  if (!serviceClient) {
    serviceClient = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY,
      { auth: { persistSession: false } }
    );
  }

  return serviceClient;
}
