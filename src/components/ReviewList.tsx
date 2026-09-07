"use client";

// The /review view — every attempted question, browsable for revision: what she
// picked, what the answer actually was, and why. Distinct from /progress, which is
// charts and trends rather than the underlying questions themselves.

import Link from "next/link";
import { useState } from "react";
import { DOMAINS } from "@/lib/satConfig";
import type { ReviewItem, ReviewOutcome } from "@/types";

const CHOICE_LABELS = ["A", "B", "C", "D"] as const;
const PAGE_SIZE = 25;

interface ReviewListProps {
  initialItems: ReviewItem[];
  initialHasMore: boolean;
}

export default function ReviewList({ initialItems, initialHasMore }: ReviewListProps) {
  const [outcome, setOutcome] = useState<ReviewOutcome>("all");
  const [subskillKey, setSubskillKey] = useState<string | null>(null);
  const [items, setItems] = useState(initialItems);
  const [hasMore, setHasMore] = useState(initialHasMore);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function fetchPage(nextOutcome: ReviewOutcome, nextSubskill: string | null, offset: number) {
    const params = new URLSearchParams({
      outcome: nextOutcome,
      offset: String(offset),
      limit: String(PAGE_SIZE),
    });
    if (nextSubskill) params.set("subskill", nextSubskill);

    const response = await fetch(`/api/review?${params.toString()}`);
    if (!response.ok) throw new Error("Could not load the review list.");
    return (await response.json()) as { items: ReviewItem[]; hasMore: boolean };
  }

  async function applyFilters(nextOutcome: ReviewOutcome, nextSubskill: string | null) {
    setOutcome(nextOutcome);
    setSubskillKey(nextSubskill);
    setLoading(true);
    setError(null);

    try {
      const page = await fetchPage(nextOutcome, nextSubskill, 0);
      setItems(page.items);
      setHasMore(page.hasMore);
    } catch {
      setError("Could not load the review list. Try again.");
    } finally {
      setLoading(false);
    }
  }

  async function loadMore() {
    setLoading(true);
    setError(null);

    try {
      const page = await fetchPage(outcome, subskillKey, items.length);
      setItems((prev) => [...prev, ...page.items]);
      setHasMore(page.hasMore);
    } catch {
      setError("Could not load more. Try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="min-h-dvh">
      <header
        className="px-6 py-4 border-b flex items-center justify-between gap-4"
        style={{ borderColor: "var(--rule)", background: "var(--card)" }}
      >
        <span
          className="text-lg"
          style={{ fontFamily: "var(--font-source-serif), Georgia, serif" }}
        >
          Revision
        </span>
        <div className="flex items-center gap-4 text-sm">
          <Link href="/progress" className="underline underline-offset-4" style={{ color: "var(--ink-mid)" }}>
            Progress
          </Link>
          <Link href="/" className="underline underline-offset-4" style={{ color: "var(--ink-mid)" }}>
            Practice
          </Link>
        </div>
      </header>

      <div className="px-6 py-8 mx-auto w-full max-w-3xl flex flex-col gap-6">
        <FilterBar
          outcome={outcome}
          subskillKey={subskillKey}
          disabled={loading}
          onChange={applyFilters}
        />

        {error && (
          <p
            role="alert"
            className="text-sm rounded-lg px-4 py-3"
            style={{ background: "var(--incorrect-soft)", color: "var(--incorrect)" }}
          >
            {error}
          </p>
        )}

        {items.length === 0 && !loading ? (
          <p className="text-sm py-16 text-center" style={{ color: "var(--ink-muted)" }}>
            Nothing to show yet. Answer some questions first, or try a different filter.
          </p>
        ) : (
          <div className="flex flex-col gap-4">
            {items.map((item) => (
              <ReviewCard key={item.attemptId} item={item} />
            ))}
          </div>
        )}

        {hasMore && (
          <button
            type="button"
            onClick={loadMore}
            disabled={loading}
            className="self-center rounded-xl px-6 py-2.5 text-sm font-medium disabled:opacity-40"
            style={{ background: "var(--card)", border: "1px solid var(--rule)", color: "var(--ink)" }}
          >
            {loading ? "Loading…" : "Load more"}
          </button>
        )}
      </div>
    </main>
  );
}

function FilterBar({
  outcome,
  subskillKey,
  disabled,
  onChange,
}: {
  outcome: ReviewOutcome;
  subskillKey: string | null;
  disabled: boolean;
  onChange: (outcome: ReviewOutcome, subskillKey: string | null) => void;
}) {
  const outcomes: { value: ReviewOutcome; label: string }[] = [
    { value: "all", label: "All" },
    { value: "incorrect", label: "Incorrect" },
    { value: "correct", label: "Correct" },
  ];

  return (
    <div className="flex flex-wrap items-center gap-3">
      <div className="flex rounded-xl overflow-hidden" style={{ border: "1px solid var(--rule)" }}>
        {outcomes.map(({ value, label }) => {
          const active = outcome === value;
          return (
            <button
              key={value}
              type="button"
              disabled={disabled}
              onClick={() => onChange(value, subskillKey)}
              className="px-4 py-2 text-sm font-medium disabled:opacity-60"
              style={{
                background: active ? "var(--ink)" : "var(--card)",
                color: active ? "var(--paper)" : "var(--ink-mid)",
              }}
            >
              {label}
            </button>
          );
        })}
      </div>

      <select
        value={subskillKey ?? ""}
        disabled={disabled}
        onChange={(event) => onChange(outcome, event.target.value || null)}
        className="rounded-xl px-3 py-2 text-sm disabled:opacity-60"
        style={{ background: "var(--card)", border: "1px solid var(--rule)", color: "var(--ink)" }}
      >
        <option value="">All subskills</option>
        {DOMAINS.map((domain) => (
          <optgroup key={domain.key} label={domain.label}>
            {domain.subskills.map((subskill) => (
              <option key={subskill.key} value={subskill.key}>
                {subskill.label}
              </option>
            ))}
          </optgroup>
        ))}
      </select>
    </div>
  );
}

function ReviewCard({ item }: { item: ReviewItem }) {
  const date = new Date(item.createdAt).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });

  return (
    <article
      className="rounded-xl px-5 py-4 flex flex-col gap-4"
      style={{ background: "var(--card)", border: "1px solid var(--rule)" }}
    >
      <div className="flex items-center justify-between gap-2 text-xs" style={{ color: "var(--ink-muted)" }}>
        <div className="flex items-center gap-2">
          <span>{item.domainLabel}</span>
          <span aria-hidden="true">·</span>
          <span>{item.subskillLabel}</span>
          <span aria-hidden="true">·</span>
          <span style={{ textTransform: "capitalize" }}>{item.difficulty}</span>
        </div>
        <span>{date}</span>
      </div>

      {item.passage && <p className="passage-type" style={{ fontSize: "0.9rem" }}>{item.passage}</p>}

      <h3 className="question-type" style={{ fontSize: "1rem" }}>
        {item.stem}
      </h3>

      <div className="flex flex-col gap-2">
        {item.choices.map((choice, index) => {
          const isCorrect = index === item.correctIndex;
          const isHerWrongPick = index === item.chosenIndex && !isCorrect;

          let background = "var(--paper)";
          let border = "var(--rule)";
          if (isCorrect) {
            background = "var(--correct-soft)";
            border = "var(--correct)";
          } else if (isHerWrongPick) {
            background = "var(--incorrect-soft)";
            border = "var(--incorrect)";
          }

          return (
            <div
              key={index}
              className="rounded-lg px-3 py-2 flex gap-3 items-baseline"
              style={{ background, border: `1px solid ${border}` }}
            >
              <span className="text-sm font-medium shrink-0" style={{ color: "var(--ink-mid)" }}>
                {CHOICE_LABELS[index]}
              </span>
              <span className="question-type" style={{ fontSize: "0.9rem" }}>
                {choice}
              </span>
            </div>
          );
        })}
      </div>

      <div
        className="rounded-lg px-4 py-3 flex flex-col gap-2"
        style={{
          background: item.wasCorrect ? "var(--correct-soft)" : "var(--incorrect-soft)",
          border: `1px solid ${item.wasCorrect ? "var(--correct)" : "var(--incorrect)"}`,
        }}
      >
        <p
          className="text-sm font-medium"
          style={{ color: item.wasCorrect ? "var(--correct)" : "var(--incorrect)" }}
        >
          {item.wasCorrect
            ? "Correct"
            : item.wasTimedOut
              ? `Out of time — the answer was ${CHOICE_LABELS[item.correctIndex]}`
              : `Not quite — the answer was ${CHOICE_LABELS[item.correctIndex]}`}
        </p>
        <p className="passage-type" style={{ fontSize: "0.9rem", color: "var(--ink)" }}>
          {item.explanation}
        </p>
      </div>
    </article>
  );
}
