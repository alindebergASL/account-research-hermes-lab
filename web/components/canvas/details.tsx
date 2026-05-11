"use client";

import type { CanvasWidget } from "../../lib/canvas/schema";

function narrow<K extends CanvasWidget["kind"]>(widget: CanvasWidget, kind: K) {
  if (widget.kind !== kind) throw new Error(`widget kind mismatch: expected ${kind}, got ${widget.kind}`);
  return widget as Extract<CanvasWidget, { kind: K }>;
}

function SourcesBlock({ widget }: { widget: CanvasWidget }) {
  if (widget.sources.length === 0 && widget.evidence.length === 0) return null;
  return (
    <div className="border-t pt-3 mt-3 space-y-2">
      <div className="text-xs uppercase tracking-wide text-muted">Sources</div>
      <ul className="space-y-1 text-sm">
        {widget.sources.map((s, i) => (
          <li key={`s-${i}`}>
            <a href={s.url} target="_blank" rel="noreferrer" className="text-accent underline">
              {s.title}
            </a>
            <span className="text-muted text-xs ml-2">accessed {s.accessed}</span>
          </li>
        ))}
      </ul>
      {widget.evidence.length > 0 ? (
        <>
          <div className="text-xs uppercase tracking-wide text-muted mt-3">Evidence</div>
          <ul className="space-y-2 text-sm">
            {widget.evidence.map((e, i) => (
              <li key={`e-${i}`}>
                <div className="text-ink">{e.text}</div>
                <div className="text-xs text-muted">
                  {e.source.title} · {e.confidence} · {e.added_at}
                </div>
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </div>
  );
}

export function MetricDetail({ widget }: { widget: CanvasWidget }) {
  const w = narrow(widget, "metric");
  return (
    <div>
      <div className="text-sm text-muted">{w.data.label}</div>
      <div className="text-5xl font-display text-ink my-2">
        {w.data.value}
        {w.data.unit ? <span className="text-2xl ml-2 text-muted">{w.data.unit}</span> : null}
      </div>
      {w.data.delta ? <div className="text-sm text-accent">{w.data.delta}</div> : null}
      {w.data.as_of ? <div className="text-xs text-muted">as of {w.data.as_of}</div> : null}
      <p className="text-sm text-ink/80 mt-3">{w.description}</p>
      <SourcesBlock widget={w} />
    </div>
  );
}

export function OpenQuestionsDetail({ widget }: { widget: CanvasWidget }) {
  const w = narrow(widget, "open_questions");
  return (
    <div>
      <p className="text-sm text-ink/80">{w.description}</p>
      <ul className="space-y-3 mt-3">
        {w.data.questions.map((q, i) => (
          <li key={i} className="border-l-2 pl-3 border-accent/40">
            <div className="text-ink">
              {q.blocking ? <span className="text-red-600 mr-1">●</span> : null}
              {q.text}
            </div>
            {q.hypothesis ? <div className="text-xs text-muted mt-1">Hypothesis: {q.hypothesis}</div> : null}
          </li>
        ))}
      </ul>
      <SourcesBlock widget={w} />
    </div>
  );
}

export function ActionPanelDetail({ widget }: { widget: CanvasWidget }) {
  const w = narrow(widget, "action_panel");
  return (
    <div>
      <p className="text-sm text-ink/80">{w.description}</p>
      <ul className="space-y-3 mt-3">
        {w.data.actions.map((a, i) => (
          <li key={i} className="border rounded-lg p-3">
            <div className="flex justify-between items-start gap-2">
              <div className="text-ink font-medium">{a.text}</div>
              <span
                className={
                  a.severity === "high"
                    ? "text-xs px-2 py-0.5 rounded bg-red-100 text-red-800"
                    : a.severity === "medium"
                    ? "text-xs px-2 py-0.5 rounded bg-amber-100 text-amber-800"
                    : "text-xs px-2 py-0.5 rounded bg-gray-100 text-gray-800"
                }
              >
                {a.severity}
              </span>
            </div>
            <div className="text-xs text-muted mt-1">{a.why}</div>
            {a.owner ? <div className="text-xs text-muted mt-1">Owner: {a.owner}</div> : null}
          </li>
        ))}
      </ul>
      <SourcesBlock widget={w} />
    </div>
  );
}

export function EvidenceBoardDetail({ widget }: { widget: CanvasWidget }) {
  const w = narrow(widget, "evidence_board");
  return (
    <div>
      <p className="text-sm text-ink/80">{w.description}</p>
      <ul className="space-y-3 mt-3">
        {w.data.snippets.map((s, i) => (
          <li key={i} className="border rounded-lg p-3">
            <div className="flex justify-between gap-2">
              <span className="text-xs uppercase tracking-wide text-muted">{s.tag ?? "note"}</span>
              <a href={s.source.url} target="_blank" rel="noreferrer" className="text-xs text-accent underline">
                {s.source.title}
              </a>
            </div>
            <div className="text-ink mt-1">{s.text}</div>
          </li>
        ))}
      </ul>
      <SourcesBlock widget={w} />
    </div>
  );
}

export function SectionRefDetail({ widget }: { widget: CanvasWidget }) {
  const w = narrow(widget, "section_ref");
  return (
    <div>
      <p className="text-sm text-ink/80">{w.description}</p>
      <div className="mt-3 rounded-lg bg-gray-50 border p-3">
        <div className="text-xs uppercase tracking-wide text-muted">section key</div>
        <div className="font-mono text-sm text-accent">{w.data.section_key}</div>
        {w.data.preview ? <div className="mt-2 text-sm text-ink">{w.data.preview}</div> : null}
      </div>
      <SourcesBlock widget={w} />
    </div>
  );
}
