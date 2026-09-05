"use client";

// Which domains are in rotation, plus the two mode switches.
//
// The three weak domains are on by default (see satConfig.ts); the rest are
// opt-in, so a session stays focused rather than spreading across all eight.

import { DOMAINS } from "@/lib/satConfig";
import type { AppSettings } from "@/types";

interface SettingsPanelProps {
  settings: AppSettings;
  onChange: (next: AppSettings) => void;
  disabled: boolean;
}

export default function SettingsPanel({ settings, onChange, disabled }: SettingsPanelProps) {
  const mathDomains = DOMAINS.filter((d) => d.section === "math");
  const rwDomains = DOMAINS.filter((d) => d.section === "rw");

  function toggleDomain(key: string) {
    const enabled = new Set(settings.enabledDomains);
    if (enabled.has(key)) {
      // Refuse to switch off the last one — an empty rotation has nothing to serve.
      if (enabled.size === 1) return;
      enabled.delete(key);
    } else {
      enabled.add(key);
    }
    onChange({ ...settings, enabledDomains: [...enabled] });
  }

  return (
    <div className="flex flex-col gap-6">
      <DomainGroup
        title="Math"
        pacing="95s per question"
        domains={mathDomains}
        settings={settings}
        onToggle={toggleDomain}
        disabled={disabled}
      />
      <DomainGroup
        title="Reading and Writing"
        pacing="71s per question"
        domains={rwDomains}
        settings={settings}
        onToggle={toggleDomain}
        disabled={disabled}
      />

      <div className="flex flex-col gap-3">
        <h3 className="text-xs uppercase tracking-wider" style={{ color: "var(--ink-muted)" }}>
          Mode
        </h3>

        <Switch
          label="Timed"
          hint="Real digital SAT pacing. Running out submits as incorrect."
          checked={settings.timerEnabled}
          disabled={disabled}
          onChange={(checked) => onChange({ ...settings, timerEnabled: checked })}
        />

        <Switch
          label="Test-day simulation"
          hint="Hard questions only. Ignores the adaptive difficulty ladder."
          checked={settings.simMode}
          disabled={disabled}
          onChange={(checked) => onChange({ ...settings, simMode: checked })}
        />
      </div>
    </div>
  );
}

function DomainGroup({
  title,
  pacing,
  domains,
  settings,
  onToggle,
  disabled,
}: {
  title: string;
  pacing: string;
  domains: typeof DOMAINS;
  settings: AppSettings;
  onToggle: (key: string) => void;
  disabled: boolean;
}) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between">
        <h3 className="text-xs uppercase tracking-wider" style={{ color: "var(--ink-muted)" }}>
          {title}
        </h3>
        <span className="text-xs" style={{ color: "var(--ink-muted)" }}>
          {pacing}
        </span>
      </div>

      {domains.map((domain) => {
        const checked = settings.enabledDomains.includes(domain.key);
        return (
          <label
            key={domain.key}
            className="flex items-start gap-3 cursor-pointer rounded-lg px-3 py-2"
            style={{
              background: checked ? "var(--amber-soft)" : "transparent",
              border: `1px solid ${checked ? "var(--amber)" : "var(--rule)"}`,
              opacity: disabled ? 0.6 : 1,
            }}
          >
            <input
              type="checkbox"
              checked={checked}
              disabled={disabled}
              onChange={() => onToggle(domain.key)}
              className="mt-1"
            />
            <span className="flex flex-col">
              <span className="text-sm font-medium" style={{ color: "var(--ink)" }}>
                {domain.label}
              </span>
              <span className="text-xs" style={{ color: "var(--ink-muted)" }}>
                {domain.subskills.length} subskills
                {domain.defaultOn ? " · focus area" : ""}
              </span>
            </span>
          </label>
        );
      })}
    </div>
  );
}

function Switch({
  label,
  hint,
  checked,
  disabled,
  onChange,
}: {
  label: string;
  hint: string;
  checked: boolean;
  disabled: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label
      className="flex items-start gap-3 cursor-pointer rounded-lg px-3 py-2"
      style={{
        background: checked ? "var(--amber-soft)" : "transparent",
        border: `1px solid ${checked ? "var(--amber)" : "var(--rule)"}`,
        opacity: disabled ? 0.6 : 1,
      }}
    >
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
        className="mt-1"
      />
      <span className="flex flex-col">
        <span className="text-sm font-medium" style={{ color: "var(--ink)" }}>
          {label}
        </span>
        <span className="text-xs" style={{ color: "var(--ink-muted)" }}>
          {hint}
        </span>
      </span>
    </label>
  );
}
