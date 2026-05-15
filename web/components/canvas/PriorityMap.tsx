"use client";

import { useMemo, useState } from "react";
import type {
  PriorityMap as PriorityMapData,
  PriorityMapInitiative,
  RelationshipEdge,
} from "@/lib/canvas/priorityMap/schema";

const CONF_COLOR: Record<string, string> = {
  High: "#059669",
  Medium: "#d97706",
  Low: "#6b7280",
  "Not found": "#9ca3af",
};

const EDGE_COLOR: Record<RelationshipEdge["kind"], string> = {
  persona: "#2f6df6",
  risk: "#dc2626",
  signal: "#0891b2",
  next_action: "#7c3aed",
};

const EDGE_LABEL: Record<RelationshipEdge["kind"], string> = {
  persona: "Persona",
  risk: "Risk",
  signal: "Signal",
  next_action: "Next action",
};

interface Props {
  data: PriorityMapData;
}

// 5x5 grid. Origin (0,0) is the bottom-left ("Defer"); (5,5) is top-right
// ("Do now"). The component is deterministic: same `data` → same visual.
export default function PriorityMap({ data }: Props) {
  const [selectedId, setSelectedId] = useState<string | null>(
    data.initiatives[0]?.id ?? null,
  );
  const selected = useMemo(
    () => data.initiatives.find((i) => i.id === selectedId) ?? null,
    [data.initiatives, selectedId],
  );

  // Cluster initiatives by cell so we can fan them out instead of stacking.
  const cells = useMemo(() => {
    const map = new Map<string, PriorityMapInitiative[]>();
    for (const i of data.initiatives) {
      const k = `${i.urgency}:${i.impact}`;
      const arr = map.get(k) ?? [];
      arr.push(i);
      map.set(k, arr);
    }
    return map;
  }, [data.initiatives]);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-5 gap-4" data-testid="priority-map">
      <div className="lg:col-span-3 bg-white border rounded-2xl shadow-sm p-4">
        <div className="flex items-baseline justify-between mb-3">
          <div>
            <div className="text-xs uppercase tracking-wide text-muted">Priority map</div>
            <h2 className="font-display text-xl text-ink">{data.account_name}</h2>
          </div>
          <div className="text-xs text-muted">
            {data.diagnostics.initiative_count} initiatives · {data.diagnostics.edge_count} edges
          </div>
        </div>
        <Matrix
          data={data}
          cells={cells}
          selectedId={selectedId}
          onSelect={setSelectedId}
        />
        <Legend />
      </div>

      <div className="lg:col-span-2 bg-white border rounded-2xl shadow-sm p-4 min-h-[420px]">
        {selected ? (
          <DetailPanel initiative={selected} data={data} />
        ) : (
          <div className="text-sm text-muted">Select an initiative to see its relationships.</div>
        )}
      </div>
    </div>
  );
}

function Matrix({
  data,
  cells,
  selectedId,
  onSelect,
}: {
  data: PriorityMapData;
  cells: Map<string, PriorityMapInitiative[]>;
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  const W = 520;
  const H = 360;
  const PAD = { l: 56, r: 16, t: 16, b: 44 };
  const innerW = W - PAD.l - PAD.r;
  const innerH = H - PAD.t - PAD.b;
  const cellW = innerW / 5;
  const cellH = innerH / 5;

  // Quadrant background tinting.
  const quadrants = [
    { x: 0, y: 0, w: 2.5, h: 2.5, fill: "#f3f4f6", label: "Defer" },
    { x: 2.5, y: 0, w: 2.5, h: 2.5, fill: "#fefce8", label: "Quick wins" },
    { x: 0, y: 2.5, w: 2.5, h: 2.5, fill: "#eef2ff", label: "Plan" },
    { x: 2.5, y: 2.5, w: 2.5, h: 2.5, fill: "#ecfdf5", label: "Do now" },
  ];

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto" role="img" aria-label="Priority matrix">
      {/* Quadrants */}
      {quadrants.map((q) => (
        <g key={q.label}>
          <rect
            x={PAD.l + q.x * cellW}
            y={PAD.t + (5 - q.y - q.h) * cellH}
            width={q.w * cellW}
            height={q.h * cellH}
            fill={q.fill}
          />
          <text
            x={PAD.l + (q.x + q.w / 2) * cellW}
            y={PAD.t + (5 - q.y - q.h) * cellH + 16}
            textAnchor="middle"
            fontSize="10"
            fontFamily="ui-sans-serif, system-ui"
            fill="#6b7280"
            letterSpacing="0.08em"
          >
            {q.label.toUpperCase()}
          </text>
        </g>
      ))}

      {/* Grid lines */}
      {[0, 1, 2, 3, 4, 5].map((n) => (
        <g key={`g-${n}`} stroke="#e5e7eb" strokeWidth={1}>
          <line x1={PAD.l + n * cellW} y1={PAD.t} x2={PAD.l + n * cellW} y2={PAD.t + innerH} />
          <line x1={PAD.l} y1={PAD.t + n * cellH} x2={PAD.l + innerW} y2={PAD.t + n * cellH} />
        </g>
      ))}

      {/* Axis labels */}
      <text x={PAD.l + innerW / 2} y={H - 12} textAnchor="middle" fontSize="11" fill="#111827">
        Urgency →
      </text>
      <text
        x={16}
        y={PAD.t + innerH / 2}
        textAnchor="middle"
        fontSize="11"
        fill="#111827"
        transform={`rotate(-90 16 ${PAD.t + innerH / 2})`}
      >
        Impact →
      </text>

      {/* Tick labels */}
      {[1, 2, 3, 4, 5].map((n) => (
        <text
          key={`xt-${n}`}
          x={PAD.l + (n - 0.5) * cellW}
          y={PAD.t + innerH + 16}
          textAnchor="middle"
          fontSize="10"
          fill="#6b7280"
        >
          {n}
        </text>
      ))}
      {[1, 2, 3, 4, 5].map((n) => (
        <text
          key={`yt-${n}`}
          x={PAD.l - 8}
          y={PAD.t + (5 - n + 0.5) * cellH + 4}
          textAnchor="end"
          fontSize="10"
          fill="#6b7280"
        >
          {n}
        </text>
      ))}

      {/* Initiative dots */}
      {Array.from(cells.entries()).map(([cellKey, items]) => {
        const [u, im] = cellKey.split(":").map(Number);
        const cx0 = PAD.l + (u - 0.5) * cellW;
        const cy0 = PAD.t + (5 - im + 0.5) * cellH;
        // Fan dots out horizontally if multiple share a cell.
        return items.map((init, i) => {
          const offset = (i - (items.length - 1) / 2) * 18;
          const cx = cx0 + offset;
          const cy = cy0;
          const r = 8 + Math.min(init.evidence_count, 6) * 1.5;
          const color = CONF_COLOR[init.confidence] ?? "#6b7280";
          const selected = init.id === selectedId;
          return (
            <g
              key={init.id}
              data-initiative-id={init.id}
              style={{ cursor: "pointer" }}
              onClick={() => onSelect(init.id)}
            >
              <circle
                cx={cx}
                cy={cy}
                r={r + (selected ? 4 : 0)}
                fill={color}
                fillOpacity={selected ? 0.95 : 0.7}
                stroke={selected ? "#111827" : color}
                strokeWidth={selected ? 2 : 1}
              />
              <title>
                {init.title} — impact {init.impact}, urgency {init.urgency},{" "}
                {init.edges.length} edges
              </title>
            </g>
          );
        });
      })}
    </svg>
  );
}

function Legend() {
  return (
    <div className="mt-3 flex flex-wrap gap-3 text-xs text-muted">
      <LegendDot color={CONF_COLOR.High} label="High conf." />
      <LegendDot color={CONF_COLOR.Medium} label="Medium" />
      <LegendDot color={CONF_COLOR.Low} label="Low" />
      <span className="text-muted">·</span>
      <span>Dot size = edge count</span>
    </div>
  );
}

function LegendDot({ color, label }: { color: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1">
      <span
        className="inline-block rounded-full"
        style={{ width: 10, height: 10, backgroundColor: color }}
      />
      {label}
    </span>
  );
}

function DetailPanel({
  initiative,
  data,
}: {
  initiative: PriorityMapInitiative;
  data: PriorityMapData;
}) {
  const grouped = useMemo(() => {
    const g: Record<RelationshipEdge["kind"], RelationshipEdge[]> = {
      persona: [],
      risk: [],
      signal: [],
      next_action: [],
    };
    for (const e of initiative.edges) g[e.kind].push(e);
    return g;
  }, [initiative]);

  return (
    <div data-testid="detail-panel" data-selected-id={initiative.id}>
      <div className="text-xs uppercase tracking-wide text-muted">Initiative</div>
      <h3 className="font-display text-lg text-ink">{initiative.title}</h3>
      <div className="flex flex-wrap gap-2 mt-2 text-[11px]">
        <Chip label={`Impact ${initiative.impact}`} />
        <Chip label={`Urgency ${initiative.urgency}`} />
        <Chip label={initiative.confidence} tone="confidence" />
        <Chip label={`${initiative.evidence_count} edges`} />
      </div>
      <p className="text-sm text-ink/80 mt-3">{initiative.detail}</p>

      {(["persona", "risk", "signal", "next_action"] as const).map((kind) => {
        const edges = grouped[kind];
        if (edges.length === 0) return null;
        return (
          <div key={kind} className="mt-4">
            <div
              className="text-xs uppercase tracking-wide"
              style={{ color: EDGE_COLOR[kind] }}
            >
              {EDGE_LABEL[kind]}{edges.length > 1 ? `s (${edges.length})` : ""}
            </div>
            <ul className="mt-1 space-y-1">
              {edges.map((e) => (
                <li key={e.target_id} className="text-sm">
                  <div className="flex items-baseline gap-2">
                    <span
                      className="inline-block rounded-full shrink-0"
                      style={{
                        width: 8,
                        height: 8,
                        backgroundColor: EDGE_COLOR[kind],
                      }}
                    />
                    <div className="min-w-0">
                      <div className="text-ink">{e.label}</div>
                      <div className="text-[11px] text-muted">{e.evidence_text}</div>
                      {e.confidence ? (
                        <div className="text-[10px] uppercase tracking-wide text-muted">
                          {e.confidence}
                        </div>
                      ) : null}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        );
      })}

      {data.next_action && grouped.next_action.length === 0 ? (
        <div className="mt-4 text-xs text-muted">
          Brief-level next action: <span className="text-ink">{data.next_action}</span>
        </div>
      ) : null}
    </div>
  );
}

function Chip({ label, tone }: { label: string; tone?: "confidence" }) {
  let cls = "bg-gray-100 text-ink";
  if (tone === "confidence") {
    if (label === "High") cls = "bg-emerald-100 text-emerald-800";
    else if (label === "Medium") cls = "bg-amber-100 text-amber-800";
    else cls = "bg-gray-100 text-gray-700";
  }
  return <span className={`px-2 py-0.5 rounded ${cls}`}>{label}</span>;
}
