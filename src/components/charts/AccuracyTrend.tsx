"use client";

// One subskill's cumulative accuracy over time, drawn as a small multiple.
//
// Small multiples rather than one twelve-line chart on purpose: twelve categorical
// colours cannot be told apart under colour-vision deficiency, and the question
// being asked here is "is THIS subskill improving", not "which subskill is highest".
// One series per panel means no categorical palette and no legend — the panel
// title names the series.

import { useState } from "react";
import type { TrendPoint } from "@/types";

interface AccuracyTrendProps {
  label: string;
  domainLabel: string;
  points: TrendPoint[];
  currentAccuracy: number | null;
  totalAttempts: number;
}

const WIDTH = 280;
const HEIGHT = 96;
const PAD_X = 8;
const PAD_Y = 10;
const PLOT_W = WIDTH - PAD_X * 2;
const PLOT_H = HEIGHT - PAD_Y * 2;

/** Gridlines at 25/50/75%, plus the 0 and 1 bounds implied by the plot edges. */
const GRID_LEVELS = [0.25, 0.5, 0.75];

export default function AccuracyTrend({
  label,
  domainLabel,
  points,
  currentAccuracy,
  totalAttempts,
}: AccuracyTrendProps) {
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);

  const usable = points.filter((p): p is TrendPoint & { accuracy: number } =>
    p.accuracy !== null
  );

  /** x position for point i. A single point sits centred rather than at x=0. */
  const xFor = (index: number) =>
    usable.length <= 1
      ? PAD_X + PLOT_W / 2
      : PAD_X + (index / (usable.length - 1)) * PLOT_W;

  const yFor = (accuracy: number) => PAD_Y + (1 - accuracy) * PLOT_H;

  const path = usable
    .map((point, index) => `${index === 0 ? "M" : "L"}${xFor(index)},${yFor(point.accuracy)}`)
    .join(" ");

  const hovered = hoverIndex !== null ? usable[hoverIndex] : null;

  return (
    <figure
      className="rounded-xl px-4 py-3 m-0"
      style={{ background: "var(--card)", border: "1px solid var(--rule)" }}
    >
      <figcaption className="mb-2">
        <div className="flex items-baseline justify-between gap-2">
          <span className="text-sm font-medium" style={{ color: "var(--ink)" }}>
            {label}
          </span>
          <span className="text-sm" style={{ color: "var(--ink)" }}>
            {currentAccuracy === null ? "—" : `${Math.round(currentAccuracy * 100)}%`}
          </span>
        </div>
        <div className="flex items-baseline justify-between gap-2">
          <span className="text-xs" style={{ color: "var(--ink-muted)" }}>
            {domainLabel}
          </span>
          <span className="tabular text-xs" style={{ color: "var(--ink-muted)" }}>
            {totalAttempts} attempted
          </span>
        </div>
      </figcaption>

      {usable.length === 0 ? (
        <p className="text-xs py-6 text-center" style={{ color: "var(--ink-muted)" }}>
          No attempts yet
        </p>
      ) : (
        <svg
          width="100%"
          viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
          role="img"
          aria-label={`${label}: cumulative accuracy across ${usable.length} days, currently ${
            currentAccuracy === null ? "unknown" : `${Math.round(currentAccuracy * 100)} percent`
          }`}
          onMouseLeave={() => setHoverIndex(null)}
        >
          {/* Recessive solid hairlines — never dashed, which would read as a threshold. */}
          {GRID_LEVELS.map((level) => (
            <line
              key={level}
              x1={PAD_X}
              x2={WIDTH - PAD_X}
              y1={yFor(level)}
              y2={yFor(level)}
              stroke="var(--grid)"
              strokeWidth={1}
            />
          ))}

          <path d={path} fill="none" stroke="var(--mark)" strokeWidth={2} strokeLinejoin="round" />

          {/* Endpoint marker, direct-labelled above. Only the endpoint gets a
              label — a number on every point would be unreadable noise. */}
          {usable.length > 0 && (
            <circle
              cx={xFor(usable.length - 1)}
              cy={yFor(usable[usable.length - 1].accuracy)}
              r={4}
              fill="var(--amber)"
              stroke="var(--card)"
              strokeWidth={2}
            />
          )}

          {hovered && hoverIndex !== null && (
            <>
              <line
                x1={xFor(hoverIndex)}
                x2={xFor(hoverIndex)}
                y1={PAD_Y}
                y2={HEIGHT - PAD_Y}
                stroke="var(--ink-muted)"
                strokeWidth={1}
              />
              <circle
                cx={xFor(hoverIndex)}
                cy={yFor(hovered.accuracy)}
                r={4}
                fill="var(--mark)"
                stroke="var(--card)"
                strokeWidth={2}
              />
            </>
          )}

          {/* Invisible wide hit strips: the hover target is the full column, not
              the 8px dot, so it is usable on a trackpad and on touch. */}
          {usable.map((_, index) => {
            const stripWidth = PLOT_W / Math.max(1, usable.length);
            return (
              <rect
                key={index}
                x={xFor(index) - stripWidth / 2}
                y={0}
                width={stripWidth}
                height={HEIGHT}
                fill="transparent"
                onMouseEnter={() => setHoverIndex(index)}
              />
            );
          })}
        </svg>
      )}

      <p className="tabular text-xs mt-1 h-4" style={{ color: "var(--ink-muted)" }}>
        {hovered
          ? `${hovered.date} · ${Math.round(hovered.accuracy * 100)}% · ${hovered.attempts} that day`
          : usable.length > 0
            ? `${usable[0].date} – ${usable[usable.length - 1].date}`
            : ""}
      </p>
    </figure>
  );
}
