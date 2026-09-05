"use client";

// Questions attempted per day, split into correct and incorrect.
//
// Two segments of the same measure (attempts), so this is an ordered part-to-whole
// rather than two independent categories — one hue at two steps, not two hues. A
// legend is present because there are two segments, and a 2px surface gap
// separates them instead of a border.

import { useState } from "react";

interface VolumeBarsProps {
  data: { date: string; attempts: number; correct: number }[];
}

const HEIGHT = 180;
const PAD_TOP = 12;
const PAD_BOTTOM = 28;
const PLOT_H = HEIGHT - PAD_TOP - PAD_BOTTOM;
const BAR_GAP = 4;
/** The 2px surface gap between the two stacked segments. */
const SEGMENT_GAP = 2;

export default function VolumeBars({ data }: VolumeBarsProps) {
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);

  if (data.length === 0) {
    return (
      <p className="text-sm py-10 text-center" style={{ color: "var(--ink-muted)" }}>
        No practice logged yet.
      </p>
    );
  }

  const maxAttempts = Math.max(...data.map((d) => d.attempts), 1);
  const width = Math.max(320, data.length * 28);
  const barWidth = (width - BAR_GAP * (data.length - 1)) / data.length;

  const hovered = hoverIndex !== null ? data[hoverIndex] : null;

  return (
    <figure className="m-0">
      <div className="flex items-center gap-4 mb-3 text-xs" style={{ color: "var(--ink-mid)" }}>
        <span className="flex items-center gap-1.5">
          <span
            aria-hidden="true"
            className="inline-block w-3 h-3 rounded-sm"
            style={{ background: "var(--mark)" }}
          />
          Correct
        </span>
        <span className="flex items-center gap-1.5">
          <span
            aria-hidden="true"
            className="inline-block w-3 h-3 rounded-sm"
            style={{ background: "var(--mark-soft)" }}
          />
          Incorrect
        </span>
        <span className="ml-auto tabular h-4">
          {hovered
            ? `${hovered.date} · ${hovered.correct}/${hovered.attempts} correct`
            : ""}
        </span>
      </div>

      {/* Wide content scrolls inside its own container so the page body never
          scrolls sideways on a phone. */}
      <div className="overflow-x-auto">
        <svg
          width={width}
          height={HEIGHT}
          role="img"
          aria-label={`Questions attempted per day across ${data.length} days`}
          onMouseLeave={() => setHoverIndex(null)}
        >
          {data.map((day, index) => {
            const x = index * (barWidth + BAR_GAP);
            const totalH = (day.attempts / maxAttempts) * PLOT_H;
            const correctH = (day.correct / maxAttempts) * PLOT_H;
            const incorrectH = Math.max(0, totalH - correctH - SEGMENT_GAP);
            const isHovered = hoverIndex === index;

            return (
              <g
                key={day.date}
                onMouseEnter={() => setHoverIndex(index)}
                opacity={hoverIndex === null || isHovered ? 1 : 0.55}
              >
                {/* Incorrect sits on top of correct, both anchored to the baseline. */}
                {incorrectH > 0 && (
                  <rect
                    x={x}
                    y={PAD_TOP + PLOT_H - totalH}
                    width={barWidth}
                    height={incorrectH}
                    rx={2}
                    fill="var(--mark-soft)"
                  />
                )}
                <rect
                  x={x}
                  y={PAD_TOP + PLOT_H - correctH}
                  width={barWidth}
                  height={correctH}
                  rx={2}
                  fill="var(--mark)"
                />
                {/* Full-height hit target, so hovering does not require landing on
                    a 6px bar. */}
                <rect
                  x={x - BAR_GAP / 2}
                  y={0}
                  width={barWidth + BAR_GAP}
                  height={HEIGHT}
                  fill="transparent"
                />
              </g>
            );
          })}

          {/* Baseline: a solid hairline, one shade off the surface. */}
          <line
            x1={0}
            x2={width}
            y1={PAD_TOP + PLOT_H}
            y2={PAD_TOP + PLOT_H}
            stroke="var(--rule)"
            strokeWidth={1}
          />

          {/* Label the first, middle and last day only — a tick under every bar
              would collide at four weeks of data. */}
          {[0, Math.floor(data.length / 2), data.length - 1]
            .filter((index, position, all) => all.indexOf(index) === position)
            .map((index) => (
              <text
                key={index}
                x={index * (barWidth + BAR_GAP) + barWidth / 2}
                y={HEIGHT - 8}
                textAnchor="middle"
                className="tabular"
                fontSize={10}
                fill="var(--ink-muted)"
              >
                {data[index].date.slice(5)}
              </text>
            ))}
        </svg>
      </div>
    </figure>
  );
}
