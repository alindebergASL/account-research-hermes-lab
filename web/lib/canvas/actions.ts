import { z } from "zod";
import { Confidence, Source, CanvasWidget, WidgetStatus, WidgetKind } from "./schema";

export const HermesActionKind = z.enum([
  "append_widget",
  "update_widget",
  "remove_widget",
  "mark_status",
  "add_evidence",
  "propose_refresh",
]);
export type HermesActionKind = z.infer<typeof HermesActionKind>;

export const AppendWidgetPayload = z.object({ widget: CanvasWidget });
export const UpdateWidgetPayload = z.object({
  widget_id: z.string().min(1),
  patch: z
    .object({
      title: z.string().optional(),
      description: z.string().optional(),
      data: z.unknown().optional(),
    })
    .refine((p) => Object.keys(p).length > 0, "patch must have at least one field"),
});
export const RemoveWidgetPayload = z.object({ widget_id: z.string().min(1) });
export const MarkStatusPayload = z.object({
  widget_id: z.string().min(1),
  status: WidgetStatus,
});
export const AddEvidencePayload = z.object({
  widget_id: z.string().min(1),
  text: z.string().min(1),
  source: Source,
  confidence: Confidence,
});
export const ProposeRefreshPayload = z.object({
  widget_id: z.string().min(1).optional(),
  scope: z.enum(["widget", "canvas"]).default("widget"),
  reason: z.string().min(1),
});

export const HermesAction = z.object({
  id: z.string().min(1),
  kind: HermesActionKind,
  payload: z.unknown(),
  rationale: z.string().min(1),
  evidence: z.array(Source).default([]),
  proposed_at: z.string(),
  proposed_by: z.enum(["hermes", "user", "system"]),
  state: z.enum(["proposed", "auto_applied", "applied", "rejected", "expired", "undone"]),
  confidence: Confidence,
  decided_at: z.string().optional(),
  decided_by: z.string().optional(),
  reject_reason: z.string().optional(),
});
export type HermesAction = z.infer<typeof HermesAction>;

// Validate payload per kind. Throws if invalid.
export function validateActionPayload(kind: HermesActionKind, payload: unknown) {
  switch (kind) {
    case "append_widget":
      return AppendWidgetPayload.parse(payload);
    case "update_widget":
      return UpdateWidgetPayload.parse(payload);
    case "remove_widget":
      return RemoveWidgetPayload.parse(payload);
    case "mark_status":
      return MarkStatusPayload.parse(payload);
    case "add_evidence":
      return AddEvidencePayload.parse(payload);
    case "propose_refresh":
      return ProposeRefreshPayload.parse(payload);
  }
}

// Auto-apply policy: which (kind, widgetKind?) combos auto-apply when confidence >= Medium
// and at least one piece of evidence is attached.
//
// Lab defaults — additive only auto-applies for safe widget kinds. Anything that can
// hide or destroy state, or that costs money, always requires confirmation.
const SAFE_AUTO_APPEND_KINDS: WidgetKind[] = [
  "metric",
  "open_questions",
  "evidence_board",
  "section_ref",
];

export function isAutoApply(action: HermesAction): boolean {
  if (action.confidence === "Low" || action.confidence === "Not found") return false;
  if (action.evidence.length === 0) return false;

  switch (action.kind) {
    case "append_widget": {
      const payload = AppendWidgetPayload.safeParse(action.payload);
      if (!payload.success) return false;
      return SAFE_AUTO_APPEND_KINDS.includes(payload.data.widget.kind);
    }
    case "add_evidence":
      return true;
    case "mark_status": {
      const payload = MarkStatusPayload.safeParse(action.payload);
      if (!payload.success) return false;
      return payload.data.status === "fresh" || payload.data.status === "watching";
    }
    case "update_widget":
      // Content updates auto-apply if confident and evidenced; in the lab we keep this
      // confirm-only to keep the demo flow easy to read.
      return false;
    case "remove_widget":
    case "propose_refresh":
      return false;
  }
}
