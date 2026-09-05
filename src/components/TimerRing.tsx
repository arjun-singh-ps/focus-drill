"use client";

// The per-question countdown.
//
// The remaining seconds are always shown as a number, not just as ring length —
// colour and arc length alone would leave a colour-blind or low-vision user
// guessing how long they have.

interface TimerRingProps {
  secondsRemaining: number;
  secondsTotal: number;
}

const SIZE = 44;
const STROKE = 3;
const RADIUS = (SIZE - STROKE) / 2;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

/** Below this fraction of the budget the ring warns. */
const WARN_FRACTION = 0.2;

export default function TimerRing({ secondsRemaining, secondsTotal }: TimerRingProps) {
  const fraction = secondsTotal > 0 ? Math.max(0, secondsRemaining / secondsTotal) : 0;
  const warning = fraction <= WARN_FRACTION;
  const colour = warning ? "var(--amber)" : "var(--ink-mid)";

  return (
    <div
      className="flex items-center gap-2"
      role="timer"
      aria-live="off"
      aria-label={`${secondsRemaining} seconds remaining`}
    >
      <svg width={SIZE} height={SIZE} aria-hidden="true">
        <circle
          cx={SIZE / 2}
          cy={SIZE / 2}
          r={RADIUS}
          fill="none"
          stroke="var(--rule)"
          strokeWidth={STROKE}
        />
        <circle
          cx={SIZE / 2}
          cy={SIZE / 2}
          r={RADIUS}
          fill="none"
          stroke={colour}
          strokeWidth={STROKE}
          strokeLinecap="round"
          strokeDasharray={CIRCUMFERENCE}
          strokeDashoffset={CIRCUMFERENCE * (1 - fraction)}
          // Start the arc at 12 o'clock and drain clockwise.
          transform={`rotate(-90 ${SIZE / 2} ${SIZE / 2})`}
        />
      </svg>
      <span className="tabular text-sm font-medium" style={{ color: colour }}>
        {Math.floor(secondsRemaining / 60)}:
        {String(secondsRemaining % 60).padStart(2, "0")}
      </span>
    </div>
  );
}
