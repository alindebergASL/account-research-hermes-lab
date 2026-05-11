"use client";

import type { CanvasWidget } from "@/lib/canvas/schema";
import { getDescriptor } from "@/lib/canvas/registry";

const STATUS_BADGE: Record<string, string> = {
  fresh: "bg-emerald-100 text-emerald-800",
  stale: "bg-amber-100 text-amber-800",
  watching: "bg-sky-100 text-sky-800",
  archived: "bg-gray-200 text-gray-700",
};

const CONFIDENCE_BADGE: Record<string, string> = {
  High: "bg-emerald-100 text-emerald-800",
  Medium: "bg-amber-100 text-amber-800",
  Low: "bg-gray-100 text-gray-700",
  "Not found": "bg-gray-100 text-gray-500",
};

export default function WidgetTile({
  widget,
  onOpen,
}: {
  widget: CanvasWidget;
  onOpen: () => void;
}) {
  const desc = getDescriptor(widget.kind);
  const Tile = desc.Tile;
  const span = Math.max(1, Math.min(12, widget.layout.w));
  return (
    <div
      className="bg-white border rounded-2xl shadow-sm p-4 flex flex-col col-span-12"
      style={{ gridColumn: `span ${span} / span ${span}` }}
      data-widget-id={widget.id}
      data-widget-kind={widget.kind}
    >
      <div className="flex items-start justify-between gap-2 mb-2">
        <div className="min-w-0">
          <div className="text-xs uppercase tracking-wide text-muted">{desc.label}</div>
          <button
            className="text-ink font-medium text-left truncate hover:underline"
            onClick={onOpen}
          >
            {widget.title}
          </button>
        </div>
        <div className="flex gap-1 shrink-0">
          <span className={`text-[10px] px-2 py-0.5 rounded ${CONFIDENCE_BADGE[widget.confidence]}`}>
            {widget.confidence}
          </span>
          <span className={`text-[10px] px-2 py-0.5 rounded ${STATUS_BADGE[widget.status]}`}>
            {widget.status}
          </span>
        </div>
      </div>
      <div className="flex-1">
        <Tile widget={widget} />
      </div>
      <div className="mt-3 pt-2 border-t flex items-center justify-between text-xs text-muted">
        <span>
          {widget.source} · {widget.sources.length} source{widget.sources.length === 1 ? "" : "s"}
        </span>
        <button className="text-accent hover:underline" onClick={onOpen}>
          Drill →
        </button>
      </div>
    </div>
  );
}
