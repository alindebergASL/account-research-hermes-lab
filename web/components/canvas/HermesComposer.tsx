"use client";

import { FAKE_HERMES_PROMPTS, FakeHermesPromptId } from "@/lib/canvas/fakeHermes";

export default function HermesComposer({ onPrompt }: { onPrompt: (id: FakeHermesPromptId) => void }) {
  return (
    <div className="bg-white border rounded-2xl shadow-sm p-4" data-testid="hermes-composer">
      <div className="flex items-center justify-between mb-3">
        <h2 className="font-display text-lg text-ink">Ask Hermes (lab)</h2>
        <span className="text-xs text-muted">deterministic · no API calls</span>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
        {FAKE_HERMES_PROMPTS.map((p) => (
          <button
            key={p.id}
            data-prompt-id={p.id}
            onClick={() => onPrompt(p.id)}
            className="text-left border rounded-lg p-3 hover:border-accent hover:bg-accent/5 transition"
          >
            <div className="text-sm font-medium text-ink">{p.label}</div>
            <div className="text-xs text-muted mt-1">{p.description}</div>
            <div className="text-[10px] uppercase tracking-wide mt-2 text-accent">
              → {p.expectedDecision.replace("_", " ")}
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}
