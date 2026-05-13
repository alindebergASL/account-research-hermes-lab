"use client";

import { useState } from "react";
import type { HermesAction } from "@/lib/canvas/actions";

const STATE_BADGE: Record<HermesAction["state"], string> = {
  proposed: "bg-amber-100 text-amber-800",
  applying: "bg-sky-100 text-sky-800",
  auto_applied: "bg-emerald-100 text-emerald-800",
  applied: "bg-emerald-100 text-emerald-800",
  failed: "bg-red-100 text-red-800",
  rejected: "bg-gray-200 text-gray-700",
  expired: "bg-gray-100 text-gray-500",
  undone: "bg-gray-200 text-gray-700",
};

const KIND_LABEL: Record<HermesAction["kind"], string> = {
  append_widget: "Append widget",
  update_widget: "Update widget",
  remove_widget: "Remove widget",
  mark_status: "Mark status",
  add_evidence: "Add evidence",
  propose_refresh: "Propose refresh",
};

export default function ActionQueue({
  actions,
  onApprove,
  onReject,
  onUndo,
  onRetry,
  undoableId,
  undoSecondsLeft,
}: {
  actions: HermesAction[];
  onApprove: (id: string) => void;
  onReject: (id: string, reason: string) => void;
  onUndo: (id: string) => void;
  onRetry: (id: string) => void;
  undoableId: string | null;
  undoSecondsLeft: number;
}) {
  const [filter, setFilter] = useState<"all" | "needs_approval" | "auto" | "failed" | "rejected">("all");
  const filtered = actions.filter((a) => {
    if (filter === "needs_approval") return a.state === "proposed";
    if (filter === "auto") return a.state === "auto_applied";
    if (filter === "failed") return a.state === "failed";
    if (filter === "rejected") return a.state === "rejected" || a.state === "undone";
    return true;
  });

  return (
    <div className="bg-white border rounded-2xl shadow-sm p-4 flex flex-col h-full" data-testid="action-queue">
      <div className="flex items-center justify-between mb-3">
        <h2 className="font-display text-lg text-ink">Action Queue</h2>
        <span className="text-xs text-muted">{actions.filter((a) => a.state === "proposed").length} pending</span>
      </div>
      <div className="flex gap-1 mb-3 flex-wrap">
        {(["all", "needs_approval", "auto", "failed", "rejected"] as const).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`text-xs px-2 py-1 rounded ${filter === f ? "bg-ink text-white" : "bg-gray-100 text-ink"}`}
          >
            {f.replace("_", " ")}
          </button>
        ))}
      </div>
      <div className="flex-1 overflow-y-auto space-y-2 min-h-[200px]">
        {filtered.length === 0 ? (
          <div className="text-sm text-muted text-center py-8">
            {filter === "all" ? "Hermes is quiet. Try a prompt below." : "Nothing here."}
          </div>
        ) : (
          filtered
            .slice()
            .reverse()
            .map((a) => <ActionRow key={a.id} action={a} onApprove={onApprove} onReject={onReject} onUndo={onUndo} onRetry={onRetry} undoableId={undoableId} undoSecondsLeft={undoSecondsLeft} />)
        )}
      </div>
    </div>
  );
}

function ActionRow({
  action,
  onApprove,
  onReject,
  onUndo,
  onRetry,
  undoableId,
  undoSecondsLeft,
}: {
  action: HermesAction;
  onApprove: (id: string) => void;
  onReject: (id: string, reason: string) => void;
  onUndo: (id: string) => void;
  onRetry: (id: string) => void;
  undoableId: string | null;
  undoSecondsLeft: number;
}) {
  const [showRejectInput, setShowRejectInput] = useState(false);
  const [reason, setReason] = useState("");
  const isUndoable = action.id === undoableId && (action.state === "auto_applied" || action.state === "applied");

  return (
    <div className="border rounded-lg p-3 text-sm" data-action-id={action.id} data-action-state={action.state}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="text-xs uppercase tracking-wide text-muted">{KIND_LABEL[action.kind]}</div>
          <div className="text-ink truncate">{action.rationale}</div>
        </div>
        <span className={`text-[10px] px-2 py-0.5 rounded shrink-0 ${STATE_BADGE[action.state]}`}>
          {action.state.replace("_", " ")}
        </span>
      </div>
      {action.evidence.length > 0 ? (
        <div className="text-xs text-muted mt-1">
          {action.evidence.length} source{action.evidence.length === 1 ? "" : "s"} · {action.confidence}
        </div>
      ) : (
        <div className="text-xs text-muted mt-1">no evidence · {action.confidence}</div>
      )}
      {action.reject_reason ? (
        <div className="text-xs text-red-700 mt-1">Rejected: {action.reject_reason}</div>
      ) : null}
      {action.error ? (
        <div className="text-xs text-red-700 mt-1">Error: {action.error}</div>
      ) : null}
      {action.retry_of ? (
        <div className="text-[10px] text-muted mt-1">retry of {action.retry_of}</div>
      ) : null}

      {action.state === "proposed" ? (
        <div className="mt-2 flex gap-2 flex-wrap items-center">
          <button
            data-testid="approve"
            onClick={() => onApprove(action.id)}
            className="text-xs px-3 py-1 rounded bg-emerald-600 text-white hover:bg-emerald-700"
          >
            Approve
          </button>
          {!showRejectInput ? (
            <button
              data-testid="reject"
              onClick={() => setShowRejectInput(true)}
              className="text-xs px-3 py-1 rounded bg-gray-200 text-ink hover:bg-gray-300"
            >
              Reject
            </button>
          ) : (
            <div className="flex gap-1 flex-1 min-w-[160px]">
              <input
                className="text-xs px-2 py-1 border rounded flex-1"
                placeholder="reason (required)"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                autoFocus
              />
              <button
                onClick={() => {
                  if (reason.trim()) {
                    onReject(action.id, reason.trim());
                    setReason("");
                    setShowRejectInput(false);
                  }
                }}
                className="text-xs px-2 py-1 rounded bg-red-600 text-white"
              >
                Confirm
              </button>
            </div>
          )}
        </div>
      ) : null}

      {isUndoable ? (
        <div className="mt-2">
          <button
            data-testid="undo"
            onClick={() => onUndo(action.id)}
            className="text-xs px-3 py-1 rounded bg-ink text-white hover:opacity-90"
          >
            Undo ({undoSecondsLeft}s)
          </button>
        </div>
      ) : null}

      {action.state === "failed" ? (
        <div className="mt-2 flex gap-2">
          <button
            data-testid="retry"
            onClick={() => onRetry(action.id)}
            className="text-xs px-3 py-1 rounded bg-amber-600 text-white hover:bg-amber-700"
          >
            Retry
          </button>
          <button
            data-testid="discard"
            onClick={() => onReject(action.id, "discarded after failure")}
            className="text-xs px-3 py-1 rounded bg-gray-200 text-ink hover:bg-gray-300"
          >
            Discard
          </button>
        </div>
      ) : null}
    </div>
  );
}
