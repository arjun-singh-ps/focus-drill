"use client";

// The /progress view — the "is the four-week plan actually working" dashboard.
//
// Every chart has a table-view twin, so no value is reachable only by hovering.

import Link from "next/link";
import { useState } from "react";
import AccuracyTrend from "./charts/AccuracyTrend";
import VolumeBars from "./charts/VolumeBars";
import type { ProgressData } from "@/types";

interface ProgressDashboardProps {
  data: ProgressData;
}

export default function ProgressDashboard({ data }: ProgressDashboardProps) {
  const [showTable, setShowTable] = useState(false);

  const overallAccuracy =
    data.totals.attempts > 0 ? data.totals.correct / data.totals.attempts : null;

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
          Progress
        </span>
        <div className="flex items-center gap-4 text-sm">
          <button
            type="button"
            onClick={() => setShowTable((shown) => !shown)}
            className="underline underline-offset-4"
            style={{ color: "var(--ink-mid)" }}
          >
            {showTable ? "Hide table" : "Table view"}
          </button>
          <a
            href="/api/export"
            className="underline underline-offset-4"
            style={{ color: "var(--ink-mid)" }}
          >
            Export CSV
          </a>
          <Link href="/review" className="underline underline-offset-4" style={{ color: "var(--ink-mid)" }}>
            Revision
          </Link>
          <Link href="/" className="underline underline-offset-4" style={{ color: "var(--ink-mid)" }}>
            Practice
          </Link>
        </div>
      </header>

      <div className="px-6 py-8 mx-auto w-full max-w-5xl flex flex-col gap-10">
        <section className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <StatTile
            label="Questions attempted"
            value={data.totals.attempts.toLocaleString()}
          />
          <StatTile
            label="Overall accuracy"
            value={overallAccuracy === null ? "—" : `${Math.round(overallAccuracy * 100)}%`}
          />
          <StatTile label="Days practised" value={String(data.totals.activeDays)} />
          <StatTile
            label="Flagged as broken"
            value={String(data.totals.flagged)}
            hint={data.totals.flagged > 0 ? "Not counted in accuracy" : undefined}
          />
        </section>

        <section>
          <h2 className="text-base font-medium mb-1">Accuracy by subskill, over time</h2>
          <p className="text-sm mb-4" style={{ color: "var(--ink-muted)" }}>
            Cumulative accuracy, weakest first. Each panel is one subskill — a rising
            line means the drilling is working.
          </p>

          {data.trends.length === 0 ? (
            <p className="text-sm py-10 text-center" style={{ color: "var(--ink-muted)" }}>
              Nothing to show yet. Answer some questions first.
            </p>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {data.trends.map((trend) => (
                <AccuracyTrend
                  key={trend.subskillKey}
                  label={trend.subskillLabel}
                  domainLabel={trend.domainLabel}
                  points={trend.points}
                  currentAccuracy={trend.currentAccuracy}
                  totalAttempts={trend.totalAttempts}
                />
              ))}
            </div>
          )}
        </section>

        <section>
          <h2 className="text-base font-medium mb-1">Questions per day</h2>
          <p className="text-sm mb-4" style={{ color: "var(--ink-muted)" }}>
            Volume and how much of it landed.
          </p>
          <VolumeBars data={data.dailyVolume} />
        </section>

        {data.timeoutBreakdown.length > 0 && (
          <section>
            <h2 className="text-base font-medium mb-1">Too slow, or does not know it?</h2>
            <p className="text-sm mb-4" style={{ color: "var(--ink-muted)" }}>
              Timeout rate on timed questions only. A high rate here with decent
              accuracy elsewhere means the problem is pacing, not the maths — which
              needs a different fix.
            </p>
            <TimeoutTable rows={data.timeoutBreakdown} />
          </section>
        )}

        {data.flagged.length > 0 && (
          <section>
            <h2 className="text-base font-medium mb-1">Flagged questions</h2>
            <p className="text-sm mb-4" style={{ color: "var(--ink-muted)" }}>
              Reported as wrong or unclear. These do not count against her accuracy.
              Several from the same subskill suggests the generator is struggling there.
            </p>
            <ul className="flex flex-col gap-2">
              {data.flagged.map((item) => (
                <li
                  key={item.attemptId}
                  className="rounded-xl px-4 py-3"
                  style={{ background: "var(--card)", border: "1px solid var(--rule)" }}
                >
                  <div className="flex items-baseline justify-between gap-3 mb-1">
                    <span className="text-sm font-medium">{item.subskillLabel}</span>
                    <span className="tabular text-xs" style={{ color: "var(--ink-muted)" }}>
                      {item.createdAt.slice(0, 10)} · {item.difficulty}
                    </span>
                  </div>
                  <p className="passage-type" style={{ fontSize: "0.9rem", color: "var(--ink-mid)" }}>
                    {item.stem ?? "Question text is no longer available."}
                  </p>
                </li>
              ))}
            </ul>
          </section>
        )}

        {showTable && <TableView data={data} />}
      </div>
    </main>
  );
}

function StatTile({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div
      className="rounded-xl px-4 py-3"
      style={{ background: "var(--card)", border: "1px solid var(--rule)" }}
    >
      {/* Proportional figures, not tabular — tabular digits make a large standalone
          number look loose. Sans, not serif: the serif is for question text. */}
      <p className="text-2xl" style={{ color: "var(--ink)" }}>
        {value}
      </p>
      <p className="text-xs mt-0.5" style={{ color: "var(--ink-muted)" }}>
        {label}
      </p>
      {hint && (
        <p className="text-xs mt-1" style={{ color: "var(--amber)" }}>
          {hint}
        </p>
      )}
    </div>
  );
}

function TimeoutTable({ rows }: { rows: ProgressData["timeoutBreakdown"] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm border-collapse">
        <thead>
          <tr style={{ color: "var(--ink-muted)" }}>
            <th className="text-left font-normal py-2 pr-4">Subskill</th>
            <th className="text-right font-normal py-2 px-4">Timed</th>
            <th className="text-right font-normal py-2 px-4">Ran out</th>
            <th className="text-right font-normal py-2 pl-4">Rate</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const rate = row.timeouts / row.timedAttempts;
            return (
              <tr key={row.subskillKey} style={{ borderTop: "1px solid var(--rule)" }}>
                <td className="py-2 pr-4">{row.subskillLabel}</td>
                <td className="tabular text-right py-2 px-4">{row.timedAttempts}</td>
                <td className="tabular text-right py-2 px-4">{row.timeouts}</td>
                <td
                  className="tabular text-right py-2 pl-4"
                  style={{ color: rate >= 0.25 ? "var(--amber)" : "var(--ink)" }}
                >
                  {Math.round(rate * 100)}%
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/** The WCAG-clean twin of the charts: every plotted value, as text. */
function TableView({ data }: { data: ProgressData }) {
  return (
    <section>
      <h2 className="text-base font-medium mb-3">All values</h2>

      <div className="overflow-x-auto mb-6">
        <table className="w-full text-sm border-collapse">
          <caption className="text-left text-xs pb-2" style={{ color: "var(--ink-muted)" }}>
            Accuracy by subskill
          </caption>
          <thead>
            <tr style={{ color: "var(--ink-muted)" }}>
              <th className="text-left font-normal py-2 pr-4">Subskill</th>
              <th className="text-left font-normal py-2 px-4">Domain</th>
              <th className="text-right font-normal py-2 px-4">Attempts</th>
              <th className="text-right font-normal py-2 pl-4">Accuracy</th>
            </tr>
          </thead>
          <tbody>
            {data.trends.map((trend) => (
              <tr key={trend.subskillKey} style={{ borderTop: "1px solid var(--rule)" }}>
                <td className="py-2 pr-4">{trend.subskillLabel}</td>
                <td className="py-2 px-4" style={{ color: "var(--ink-mid)" }}>
                  {trend.domainLabel}
                </td>
                <td className="tabular text-right py-2 px-4">{trend.totalAttempts}</td>
                <td className="tabular text-right py-2 pl-4">
                  {trend.currentAccuracy === null
                    ? "—"
                    : `${Math.round(trend.currentAccuracy * 100)}%`}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm border-collapse">
          <caption className="text-left text-xs pb-2" style={{ color: "var(--ink-muted)" }}>
            Questions per day
          </caption>
          <thead>
            <tr style={{ color: "var(--ink-muted)" }}>
              <th className="text-left font-normal py-2 pr-4">Date</th>
              <th className="text-right font-normal py-2 px-4">Attempted</th>
              <th className="text-right font-normal py-2 pl-4">Correct</th>
            </tr>
          </thead>
          <tbody>
            {data.dailyVolume.map((day) => (
              <tr key={day.date} style={{ borderTop: "1px solid var(--rule)" }}>
                <td className="tabular py-2 pr-4">{day.date}</td>
                <td className="tabular text-right py-2 px-4">{day.attempts}</td>
                <td className="tabular text-right py-2 pl-4">{day.correct}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
