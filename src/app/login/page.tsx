// The password gate. One field, one shared password.

import LoginForm from "@/components/LoginForm";

export default function LoginPage() {
  return (
    <main className="min-h-dvh flex items-center justify-center px-6">
      <div className="w-full max-w-sm">
        <h1
          className="text-3xl mb-1"
          style={{ fontFamily: "var(--font-source-serif), Georgia, serif", color: "var(--ink)" }}
        >
          Focus Drill
        </h1>
        <p className="text-sm mb-8" style={{ color: "var(--ink-muted)" }}>
          Adaptive SAT practice.
        </p>
        <LoginForm />
      </div>
    </main>
  );
}
