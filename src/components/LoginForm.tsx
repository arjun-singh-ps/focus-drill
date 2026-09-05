"use client";

// Posts the shared password to /api/login, which sets the signed session cookie.

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

export default function LoginForm() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);

    try {
      const response = await fetch("/api/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });

      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { error?: string } | null;
        setError(body?.error ?? "Could not sign in.");
        return;
      }

      // refresh() so the server components re-render with the new cookie before
      // the push lands — without it the redirect can bounce straight back here.
      router.push("/");
      router.refresh();
    } catch {
      setError("Could not reach the server. Check your connection.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-3">
      <label htmlFor="password" className="text-sm font-medium" style={{ color: "var(--ink-mid)" }}>
        Password
      </label>
      <input
        id="password"
        type="password"
        autoComplete="current-password"
        autoFocus
        value={password}
        onChange={(event) => setPassword(event.target.value)}
        className="w-full rounded-xl px-4 py-3 text-base outline-none"
        style={{
          background: "var(--card)",
          border: "1px solid var(--rule)",
          color: "var(--ink)",
        }}
      />

      {error && (
        <p
          role="alert"
          className="text-sm rounded-lg px-3 py-2"
          style={{ background: "var(--incorrect-soft)", color: "var(--incorrect)" }}
        >
          {error}
        </p>
      )}

      <button
        type="submit"
        disabled={submitting || password.length === 0}
        className="mt-2 rounded-xl px-4 py-3 text-base font-medium disabled:opacity-50"
        style={{ background: "var(--ink)", color: "var(--paper)" }}
      >
        {submitting ? "Checking…" : "Start"}
      </button>
    </form>
  );
}
