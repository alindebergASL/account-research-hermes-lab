"use client";

import { useMemo, useState } from "react";
import PriorityMap from "@/components/canvas/PriorityMap";
import { acmeHealthBrief } from "@/lib/canvas/priorityMap/fixtures";
import { derivePriorityMap } from "@/lib/canvas/priorityMap/derive";

// Lab-only demo route. Loads a single representative account fixture and
// renders the deterministic PriorityMap derived from its Brief.
export default function PriorityMapLabPage() {
  const [showRaw, setShowRaw] = useState(false);
  const map = useMemo(() => derivePriorityMap(acmeHealthBrief), []);

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="border-b bg-white">
        <div className="max-w-7xl mx-auto px-4 py-3 flex items-center justify-between flex-wrap gap-2">
          <div>
            <div className="text-xs uppercase tracking-wide text-muted">Hermes lab · prototype</div>
            <h1 className="font-display text-2xl text-ink">Canvas relationship / priority map</h1>
            <div className="text-xs text-muted">
              Deterministic derivation from Brief · no model calls · fixture data
            </div>
          </div>
          <button
            className="text-xs px-3 py-1.5 rounded border hover:bg-gray-100"
            onClick={() => setShowRaw((v) => !v)}
            data-testid="toggle-raw"
          >
            {showRaw ? "Hide derived JSON" : "Show derived JSON"}
          </button>
        </div>
      </div>

      <div className="max-w-7xl mx-auto p-4 space-y-4">
        <PriorityMap data={map} />

        {showRaw ? (
          <pre className="bg-white border rounded-2xl shadow-sm p-4 text-xs overflow-auto">
            {JSON.stringify(map, null, 2)}
          </pre>
        ) : null}

        <div className="bg-white border rounded-2xl shadow-sm p-4 text-sm text-ink/80">
          <div className="text-xs uppercase tracking-wide text-muted mb-2">How to read this</div>
          <ul className="list-disc pl-5 space-y-1">
            <li>Each dot is one initiative from the Brief.</li>
            <li>X position = derived urgency (from signal density).</li>
            <li>Y position = derived impact (from confidence + persona overlap).</li>
            <li>Dot color = confidence. Dot size = number of derived relationship edges.</li>
            <li>Click a dot to see its personas, risks, signals, and next-action links on the right.</li>
            <li>All derivations are deterministic — same Brief → same map.</li>
          </ul>
        </div>
      </div>
    </div>
  );
}
