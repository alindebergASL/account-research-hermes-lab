"use client";

import type { CanvasWidget } from "../../lib/canvas/schema";

// All Tiles take the full widget so they have access to provenance and can
// render kind-specific bodies. Tiles are deliberately compact; the Detail
// renderer is responsible for the deep view.

function narrow<K extends CanvasWidget["kind"]>(widget: CanvasWidget, kind: K) {
  if (widget.kind !== kind) throw new Error(`widget kind mismatch: expected ${kind}, got ${widget.kind}`);
  return widget as Extract<CanvasWidget, { kind: K }>;
}

export function MetricTile({ widget }: { widget: CanvasWidget }) {
  const w = narrow(widget, "metric");
  return (
    <div className="space-y-1">
      <div className="text-xs uppercase tracking-wide text-muted">{w.data.label}</div>
      <div className="text-3xl font-display text-ink">
        {w.data.value}
        {w.data.unit ? <span className="text-base ml-1 text-muted">{w.data.unit}</span> : null}
      </div>
      {w.data.delta ? <div className="text-xs text-accent">{w.data.delta}</div> : null}
      {w.data.as_of ? <div className="text-xs text-muted">as of {w.data.as_of}</div> : null}
    </div>
  );
}

export function OpenQuestionsTile({ widget }: { widget: CanvasWidget }) {
  const w = narrow(widget, "open_questions");
  return (
    <ul className="space-y-1 text-sm">
      {w.data.questions.slice(0, 4).map((q, i) => (
        <li key={i} className="flex gap-2">
          <span className={q.blocking ? "text-red-600 font-bold" : "text-muted"}>•</span>
          <span className="text-ink">{q.text}</span>
        </li>
      ))}
      {w.data.questions.length > 4 ? (
        <li className="text-xs text-muted pl-3">+ {w.data.questions.length - 4} more</li>
      ) : null}
    </ul>
  );
}

export function ActionPanelTile({ widget }: { widget: CanvasWidget }) {
  const w = narrow(widget, "action_panel");
  return (
    <ul className="space-y-2 text-sm">
      {w.data.actions.slice(0, 3).map((a, i) => (
        <li key={i} className="border-l-2 pl-2 border-accent/40">
          <div className="text-ink font-medium">{a.text}</div>
          <div className="text-xs text-muted">{a.why}</div>
        </li>
      ))}
    </ul>
  );
}

export function EvidenceBoardTile({ widget }: { widget: CanvasWidget }) {
  const w = narrow(widget, "evidence_board");
  return (
    <ul className="space-y-2 text-sm">
      {w.data.snippets.slice(0, 3).map((s, i) => (
        <li key={i} className="text-ink">
          <span className="text-xs uppercase tracking-wide text-muted mr-2">{s.tag ?? "note"}</span>
          {s.text}
        </li>
      ))}
      {w.data.snippets.length > 3 ? (
        <li className="text-xs text-muted">+ {w.data.snippets.length - 3} more</li>
      ) : null}
    </ul>
  );
}

export function SectionRefTile({ widget }: { widget: CanvasWidget }) {
  const w = narrow(widget, "section_ref");
  return (
    <div className="space-y-1 text-sm">
      <div className="text-xs uppercase tracking-wide text-muted">legacy section</div>
      <div className="font-mono text-xs text-accent">{w.data.section_key}</div>
      {w.data.preview ? <div className="text-ink/80">{w.data.preview}</div> : null}
    </div>
  );
}
