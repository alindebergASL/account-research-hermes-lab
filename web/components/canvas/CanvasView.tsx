"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import DrillModal from "@/components/DrillModal";
import WidgetTile from "./WidgetTile";
import ActionQueue from "./ActionQueue";
import HermesComposer from "./HermesComposer";
import {
  PersistedState,
  approve as approveAction,
  loadState,
  propose as proposeAction,
  reject as rejectAction,
  resetDemo as resetStore,
  saveState,
  undo as undoAction,
} from "@/lib/canvas/store";
import { getDescriptor } from "@/lib/canvas/registry";
import { buildProposal, FakeHermesPromptId } from "@/lib/canvas/fakeHermes";
import type { CanvasWidget } from "@/lib/canvas/schema";
import type { Canvas } from "@/lib/canvas/schema";

const UNDO_WINDOW_MS = 30_000;

export default function CanvasView() {
  const [state, setState] = useState<PersistedState | null>(null);
  const [drillId, setDrillId] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  // Undo bookkeeping for auto-applied actions
  const [undoableId, setUndoableId] = useState<string | null>(null);
  const [undoSecondsLeft, setUndoSecondsLeft] = useState(0);
  const undoSnapshotRef = useRef<Canvas | null>(null);
  const undoTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    setState(loadState());
  }, []);

  useEffect(() => {
    if (state) saveState(state);
  }, [state]);

  const clearUndo = useCallback(() => {
    if (undoTimerRef.current) {
      clearInterval(undoTimerRef.current);
      undoTimerRef.current = null;
    }
    setUndoableId(null);
    setUndoSecondsLeft(0);
    undoSnapshotRef.current = null;
  }, []);

  const startUndoWindow = useCallback((actionId: string, snapshot: Canvas) => {
    clearUndo();
    undoSnapshotRef.current = snapshot;
    setUndoableId(actionId);
    setUndoSecondsLeft(Math.floor(UNDO_WINDOW_MS / 1000));
    const started = Date.now();
    undoTimerRef.current = setInterval(() => {
      const left = Math.max(0, Math.ceil((UNDO_WINDOW_MS - (Date.now() - started)) / 1000));
      setUndoSecondsLeft(left);
      if (left <= 0) {
        clearUndo();
      }
    }, 1000);
  }, [clearUndo]);

  useEffect(() => {
    return () => {
      if (undoTimerRef.current) clearInterval(undoTimerRef.current);
    };
  }, []);

  const handlePrompt = useCallback(
    (id: FakeHermesPromptId) => {
      if (!state) return;
      const draft = buildProposal(id, state.canvas);
      if ("error" in draft) {
        setToast(draft.error);
        return;
      }
      const result = proposeAction(state, draft);
      setState(result.state);
      if (result.decision === "auto_applied" && result.previousCanvas) {
        startUndoWindow(result.action.id, result.previousCanvas);
        setToast(`Hermes auto-applied: ${result.action.kind}`);
      } else {
        setToast(`Hermes proposed: ${result.action.kind}`);
      }
    },
    [state, startUndoWindow],
  );

  const handleApprove = useCallback(
    (id: string) => {
      if (!state) return;
      const r = approveAction(state, id);
      if (!r.ok) {
        setToast(`Approve failed: ${r.error}`);
        return;
      }
      setState(r.state);
      setToast("Approved");
    },
    [state],
  );

  const handleReject = useCallback(
    (id: string, reason: string) => {
      if (!state) return;
      const r = rejectAction(state, id, reason);
      if (!r.ok) {
        setToast(`Reject failed: ${r.error}`);
        return;
      }
      setState(r.state);
      setToast("Rejected");
    },
    [state],
  );

  const handleUndo = useCallback(
    (id: string) => {
      if (!state || !undoSnapshotRef.current) return;
      const r = undoAction(state, id, undoSnapshotRef.current);
      if (!r.ok) {
        setToast(`Undo failed: ${r.error}`);
        return;
      }
      setState(r.state);
      clearUndo();
      setToast("Undone");
    },
    [state, clearUndo],
  );

  const handleReset = useCallback(() => {
    const fresh = resetStore();
    setState(fresh);
    clearUndo();
    setToast("Demo reset");
  }, [clearUndo]);

  const drillWidget = useMemo<CanvasWidget | null>(() => {
    if (!state || !drillId) return null;
    return state.canvas.widgets.find((w) => w.id === drillId) ?? null;
  }, [state, drillId]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 2500);
    return () => clearTimeout(t);
  }, [toast]);

  if (!state) {
    return <div className="p-6 text-muted">Loading lab canvas…</div>;
  }

  const Detail = drillWidget ? getDescriptor(drillWidget.kind).Detail : null;

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="border-b bg-white">
        <div className="max-w-7xl mx-auto px-4 py-3 flex items-center justify-between flex-wrap gap-2">
          <div>
            <div className="text-xs uppercase tracking-wide text-muted">Hermes lab</div>
            <h1 className="font-display text-2xl text-ink">{state.canvas.account_name}</h1>
            <div className="text-xs text-muted">
              v{state.canvas.version} · {state.canvas.widgets.length} widgets · {state.audit.length} audit events
            </div>
          </div>
          <div className="flex gap-2">
            <button
              data-testid="reset-demo"
              onClick={handleReset}
              className="text-sm px-3 py-1.5 rounded border hover:bg-gray-100"
            >
              Reset demo
            </button>
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto p-4 grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 space-y-4">
          <div className="grid grid-cols-12 gap-4" data-testid="widget-grid">
            {state.canvas.widgets.map((w) => (
              <WidgetTile key={w.id} widget={w} onOpen={() => setDrillId(w.id)} />
            ))}
          </div>
          <HermesComposer onPrompt={handlePrompt} />
        </div>
        <div className="lg:col-span-1">
          <ActionQueue
            actions={state.actions}
            onApprove={handleApprove}
            onReject={handleReject}
            onUndo={handleUndo}
            undoableId={undoableId}
            undoSecondsLeft={undoSecondsLeft}
          />
        </div>
      </div>

      {toast ? (
        <div className="fixed bottom-4 left-1/2 -translate-x-1/2 bg-ink text-white text-sm px-4 py-2 rounded-full shadow-lg" data-testid="toast">
          {toast}
        </div>
      ) : null}

      <DrillModal
        open={!!drillWidget}
        title={drillWidget?.title ?? ""}
        subtitle={drillWidget ? `${getDescriptor(drillWidget.kind).label} · ${drillWidget.confidence}` : undefined}
        onClose={() => setDrillId(null)}
      >
        {drillWidget && Detail ? <Detail widget={drillWidget} /> : null}
      </DrillModal>
    </div>
  );
}
