"use client";

// The practice loop: start → question → answer → feedback → next question.
//
// All the adaptive decisions happen on the server; this component's only jobs are
// running the clock, capturing the choice, and showing the result. Notably it never
// receives the answer key until after an answer is submitted.

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import SettingsPanel from "./SettingsPanel";
import TimerRing from "./TimerRing";
import type { AnswerResponse, AppSettings, ServedQuestion } from "@/types";

type Phase = "idle" | "warming" | "loading" | "answering" | "feedback";

const CHOICE_LABELS = ["A", "B", "C", "D"] as const;

interface PracticeSessionProps {
  initialSettings: AppSettings;
}

export default function PracticeSession({ initialSettings }: PracticeSessionProps) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [settings, setSettings] = useState<AppSettings>(initialSettings);
  const [question, setQuestion] = useState<ServedQuestion | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const [result, setResult] = useState<AnswerResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [secondsRemaining, setSecondsRemaining] = useState(0);
  const [flagged, setFlagged] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [tally, setTally] = useState({ attempted: 0, correct: 0 });

  // When the question was shown, for measuring how long she actually took. A ref
  // rather than state because changing it must not trigger a re-render.
  const startedAtRef = useRef<number>(0);
  // Guards against the timer firing a submit while a manual submit is in flight.
  const submittingRef = useRef(false);

  const submitAnswer = useCallback(
    async (choiceIndex: number | null, timedOut: boolean) => {
      if (!question || submittingRef.current) return;
      submittingRef.current = true;

      const secondsTaken = Math.round((Date.now() - startedAtRef.current) / 1000);

      try {
        const response = await fetch("/api/answer", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            questionId: question.questionId,
            choiceIndex,
            timedOut,
            secondsTaken,
          }),
        });

        if (!response.ok) {
          const body = (await response.json().catch(() => null)) as { error?: string } | null;
          setError(body?.error ?? "Could not save that answer.");
          return;
        }

        const answer = (await response.json()) as AnswerResponse;
        setResult(answer);
        setSelected(choiceIndex);
        setTally((prev) => ({
          attempted: prev.attempted + 1,
          correct: prev.correct + (answer.correct ? 1 : 0),
        }));
        setPhase("feedback");
      } catch {
        setError("Could not reach the server. Check your connection.");
      } finally {
        submittingRef.current = false;
      }
    },
    [question]
  );

  // The countdown. Only runs while a question is actually on screen and the timer
  // is switched on; the cleanup makes sure it cannot outlive the question.
  //
  // The updater here is deliberately pure — it only decrements. Firing the
  // auto-submit from inside a setState updater would run it twice under React
  // StrictMode and double-log the attempt.
  useEffect(() => {
    if (phase !== "answering" || !settings.timerEnabled || !question) return;

    const tick = setInterval(() => {
      setSecondsRemaining((remaining) => Math.max(0, remaining - 1));
    }, 1000);

    return () => clearInterval(tick);
  }, [phase, settings.timerEnabled, question]);

  // Separate effect for the expiry, so the submit is a real side effect rather
  // than something smuggled into a state updater. submittingRef stops this
  // racing a manual submit that is already in flight.
  useEffect(() => {
    if (phase !== "answering" || !settings.timerEnabled || !question) return;
    if (secondsRemaining > 0) return;

    // Auto-submit as incorrect, per real test pacing.
    void submitAnswer(null, true);
  }, [secondsRemaining, phase, settings.timerEnabled, question, submitAnswer]);

  async function loadQuestion() {
    setPhase("loading");
    setError(null);
    setResult(null);
    setSelected(null);
    setFlagged(false);

    try {
      const response = await fetch("/api/next-question", { method: "POST" });

      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { error?: string } | null;
        setError(body?.error ?? "Could not load a question.");
        setPhase("idle");
        return;
      }

      const data = (await response.json()) as {
        question: ServedQuestion;
        settings: AppSettings;
      };

      setQuestion(data.question);
      setSettings(data.settings);
      setSecondsRemaining(data.question.secondsAllowed);
      startedAtRef.current = Date.now();
      setPhase("answering");
    } catch {
      setError("Could not reach the server. Check your connection.");
      setPhase("idle");
    }
  }

  async function startSession() {
    setPhase("warming");
    setError(null);

    try {
      // Warms the question bank so the first several questions are instant.
      const response = await fetch("/api/session/start", { method: "POST" });
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { error?: string } | null;
        setError(body?.error ?? "Could not get questions ready.");
        setPhase("idle");
        return;
      }
    } catch {
      setError("Could not reach the server. Check your connection.");
      setPhase("idle");
      return;
    }

    await loadQuestion();
  }

  async function saveSettings(next: AppSettings) {
    setSettings(next);
    try {
      await fetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(next),
      });
    } catch {
      setError("Could not save that setting.");
    }
  }

  async function flagQuestion() {
    if (!result || flagged) return;
    setFlagged(true);
    try {
      await fetch("/api/flag", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ attemptId: result.attemptId }),
      });
      // Voided, so take it back out of the on-screen tally too.
      setTally((prev) => ({
        attempted: Math.max(0, prev.attempted - 1),
        correct: Math.max(0, prev.correct - (result.correct ? 1 : 0)),
      }));
    } catch {
      setFlagged(false);
      setError("Could not flag that question.");
    }
  }

  return (
    <main className="min-h-dvh flex flex-col">
      <Header
        tally={tally}
        settings={settings}
        showSettings={showSettings}
        onToggleSettings={() => setShowSettings((open) => !open)}
        timer={
          phase === "answering" && settings.timerEnabled && question ? (
            <TimerRing
              secondsRemaining={secondsRemaining}
              secondsTotal={question.secondsAllowed}
            />
          ) : null
        }
      />

      {showSettings && (
        <section
          className="px-6 py-6 border-b"
          style={{ borderColor: "var(--rule)", background: "var(--card)" }}
        >
          <div className="mx-auto w-full max-w-2xl">
            <SettingsPanel
              settings={settings}
              onChange={saveSettings}
              disabled={phase === "answering" || phase === "loading" || phase === "warming"}
            />
            {(phase === "answering" || phase === "loading") && (
              <p className="mt-4 text-xs" style={{ color: "var(--ink-muted)" }}>
                Settings are locked mid-question. They unlock after you answer.
              </p>
            )}
          </div>
        </section>
      )}

      <div className="flex-1 px-6 py-8">
        <div className="mx-auto w-full max-w-2xl">
          {error && (
            <p
              role="alert"
              className="mb-6 text-sm rounded-lg px-4 py-3"
              style={{ background: "var(--incorrect-soft)", color: "var(--incorrect)" }}
            >
              {error}
            </p>
          )}

          {phase === "idle" && <StartScreen settings={settings} onStart={startSession} />}

          {phase === "warming" && (
            <Placeholder
              title="Getting your questions ready"
              detail="Writing a few questions ahead of time, so there is no wait between them."
            />
          )}

          {phase === "loading" && <Placeholder title="Loading" detail="One moment." />}

          {(phase === "answering" || phase === "feedback") && question && (
            <QuestionView
              question={question}
              phase={phase}
              selected={selected}
              result={result}
              flagged={flagged}
              onSelect={setSelected}
              onSubmit={() => submitAnswer(selected, false)}
              onNext={loadQuestion}
              onFlag={flagQuestion}
            />
          )}
        </div>
      </div>
    </main>
  );
}

function Header({
  tally,
  settings,
  showSettings,
  onToggleSettings,
  timer,
}: {
  tally: { attempted: number; correct: number };
  settings: AppSettings;
  showSettings: boolean;
  onToggleSettings: () => void;
  timer: React.ReactNode;
}) {
  return (
    <header
      className="px-6 py-4 border-b flex items-center justify-between gap-4"
      style={{ borderColor: "var(--rule)", background: "var(--card)" }}
    >
      <div className="flex items-baseline gap-3">
        <span
          className="text-lg"
          style={{ fontFamily: "var(--font-source-serif), Georgia, serif", color: "var(--ink)" }}
        >
          Focus Drill
        </span>
        {settings.simMode && (
          <span
            className="text-xs px-2 py-0.5 rounded-full"
            style={{ background: "var(--amber-soft)", color: "var(--amber)" }}
          >
            Test day
          </span>
        )}
      </div>

      <div className="flex items-center gap-4">
        {timer}
        {tally.attempted > 0 && (
          <span className="tabular text-sm" style={{ color: "var(--ink-mid)" }}>
            {tally.correct}/{tally.attempted}
          </span>
        )}
        <Link
          href="/progress"
          className="text-sm underline underline-offset-4"
          style={{ color: "var(--ink-mid)" }}
        >
          Progress
        </Link>
        <button
          type="button"
          onClick={onToggleSettings}
          aria-expanded={showSettings}
          className="text-sm underline underline-offset-4"
          style={{ color: "var(--ink-mid)" }}
        >
          Settings
        </button>
      </div>
    </header>
  );
}

function StartScreen({ settings, onStart }: { settings: AppSettings; onStart: () => void }) {
  return (
    <div className="flex flex-col gap-6 py-8">
      <div>
        <h1
          className="text-2xl mb-2"
          style={{ fontFamily: "var(--font-source-serif), Georgia, serif" }}
        >
          Ready when you are
        </h1>
        <p className="text-sm" style={{ color: "var(--ink-mid)" }}>
          {settings.enabledDomains.length} domain
          {settings.enabledDomains.length === 1 ? "" : "s"} in rotation
          {settings.timerEnabled ? " · timed" : ""}
          {settings.simMode ? " · hard questions only" : ""}
        </p>
      </div>

      <button
        type="button"
        onClick={onStart}
        className="self-start rounded-xl px-6 py-3 text-base font-medium"
        style={{ background: "var(--ink)", color: "var(--paper)" }}
      >
        Start practising
      </button>
    </div>
  );
}

function Placeholder({ title, detail }: { title: string; detail: string }) {
  return (
    <div className="py-16 text-center">
      <p className="text-lg mb-2" style={{ fontFamily: "var(--font-source-serif), Georgia, serif" }}>
        {title}
      </p>
      <p className="text-sm" style={{ color: "var(--ink-muted)" }}>
        {detail}
      </p>
    </div>
  );
}

function QuestionView({
  question,
  phase,
  selected,
  result,
  flagged,
  onSelect,
  onSubmit,
  onNext,
  onFlag,
}: {
  question: ServedQuestion;
  phase: Phase;
  selected: number | null;
  result: AnswerResponse | null;
  flagged: boolean;
  onSelect: (index: number) => void;
  onSubmit: () => void;
  onNext: () => void;
  onFlag: () => void;
}) {
  const revealed = phase === "feedback" && result !== null;

  return (
    <article className="flex flex-col gap-6">
      <div className="flex items-center gap-2 text-xs" style={{ color: "var(--ink-muted)" }}>
        <span>{question.domainLabel}</span>
        <span aria-hidden="true">·</span>
        <span>{question.subskillLabel}</span>
        <span aria-hidden="true">·</span>
        <span style={{ textTransform: "capitalize" }}>{question.difficulty}</span>
      </div>

      {question.passage && (
        <div
          className="passage-type rounded-xl px-5 py-4"
          style={{ background: "var(--card)", border: "1px solid var(--rule)" }}
        >
          {question.passage}
        </div>
      )}

      <h2 className="question-type">{question.stem}</h2>

      <div className="flex flex-col gap-2" role="radiogroup" aria-label="Answer choices">
        {question.choices.map((choice, index) => {
          const isSelected = selected === index;
          const isCorrect = revealed && result.correctIndex === index;
          const isWrongPick = revealed && isSelected && !result.correct;

          // Feedback is never colour-alone: the correct row also gains a border
          // and a "Correct answer" label below.
          let background = "var(--card)";
          let border = "var(--rule)";
          if (isCorrect) {
            background = "var(--correct-soft)";
            border = "var(--correct)";
          } else if (isWrongPick) {
            background = "var(--incorrect-soft)";
            border = "var(--incorrect)";
          } else if (isSelected && !revealed) {
            background = "var(--amber-soft)";
            border = "var(--amber)";
          }

          return (
            <button
              key={index}
              type="button"
              role="radio"
              aria-checked={isSelected}
              disabled={revealed}
              onClick={() => onSelect(index)}
              className="text-left rounded-xl px-4 py-3 flex gap-3 items-baseline"
              style={{ background, border: `1px solid ${border}` }}
            >
              <span
                className="text-sm font-medium shrink-0"
                style={{ color: "var(--ink-mid)" }}
                aria-hidden="true"
              >
                {CHOICE_LABELS[index]}
              </span>
              <span className="question-type" style={{ fontSize: "1rem" }}>
                {choice}
              </span>
            </button>
          );
        })}
      </div>

      {revealed && (
        <div
          className="rounded-xl px-5 py-4 flex flex-col gap-3"
          style={{
            background: result.correct ? "var(--correct-soft)" : "var(--incorrect-soft)",
            border: `1px solid ${result.correct ? "var(--correct)" : "var(--incorrect)"}`,
          }}
        >
          <p
            className="text-sm font-medium"
            style={{ color: result.correct ? "var(--correct)" : "var(--incorrect)" }}
          >
            {result.correct
              ? "Correct"
              : selected === null
                ? `Out of time — the answer was ${CHOICE_LABELS[result.correctIndex]}`
                : `Not quite — the answer was ${CHOICE_LABELS[result.correctIndex]}`}
          </p>
          <p className="passage-type" style={{ fontSize: "0.95rem", color: "var(--ink)" }}>
            {result.explanation}
          </p>
        </div>
      )}

      <div className="flex items-center justify-between gap-4">
        {phase === "answering" ? (
          <button
            type="button"
            onClick={onSubmit}
            disabled={selected === null}
            className="rounded-xl px-6 py-3 text-base font-medium disabled:opacity-40"
            style={{ background: "var(--ink)", color: "var(--paper)" }}
          >
            Check answer
          </button>
        ) : (
          <button
            type="button"
            onClick={onNext}
            className="rounded-xl px-6 py-3 text-base font-medium"
            style={{ background: "var(--ink)", color: "var(--paper)" }}
          >
            Next question
          </button>
        )}

        {revealed && (
          <button
            type="button"
            onClick={onFlag}
            disabled={flagged}
            className="text-sm underline underline-offset-4 disabled:no-underline"
            style={{ color: flagged ? "var(--ink-muted)" : "var(--ink-mid)" }}
          >
            {flagged ? "Flagged — this one will not count" : "This question looks wrong"}
          </button>
        )}
      </div>
    </article>
  );
}
