import { Canvas, CanvasWidget } from "./schema";
import {
  HermesAction,
  AppendWidgetPayload,
  UpdateWidgetPayload,
  RemoveWidgetPayload,
  MarkStatusPayload,
  AddEvidencePayload,
  validateActionPayload,
} from "./actions";

export type ApplyResult =
  | { ok: true; canvas: Canvas; previous: Canvas }
  | { ok: false; error: string };

// Pure: apply a single action to a canvas, returning a new canvas. The previous
// canvas is returned so the caller can implement undo.
export function applyAction(canvas: Canvas, action: HermesAction): ApplyResult {
  try {
    validateActionPayload(action.kind, action.payload);
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }

  const previous = canvas;
  const now = new Date().toISOString();

  switch (action.kind) {
    case "append_widget": {
      const { widget } = AppendWidgetPayload.parse(action.payload);
      if (canvas.widgets.some((w) => w.id === widget.id)) {
        return { ok: false, error: `widget id ${widget.id} already exists` };
      }
      if (widget.idem_key && canvas.widgets.some((w) => w.idem_key === widget.idem_key)) {
        return { ok: false, error: `widget with idem_key ${widget.idem_key} already exists` };
      }
      return {
        ok: true,
        previous,
        canvas: {
          ...canvas,
          version: canvas.version + 1,
          generated_at: now,
          widgets: [...canvas.widgets, widget],
        },
      };
    }
    case "update_widget": {
      const { widget_id, patch } = UpdateWidgetPayload.parse(action.payload);
      const idx = canvas.widgets.findIndex((w) => w.id === widget_id);
      if (idx < 0) return { ok: false, error: `widget ${widget_id} not found` };
      const target = canvas.widgets[idx];
      const updated = {
        ...target,
        ...(patch.title !== undefined ? { title: patch.title } : {}),
        ...(patch.description !== undefined ? { description: patch.description } : {}),
        ...(patch.data !== undefined ? { data: patch.data } : {}),
        updated_at: now,
      } as CanvasWidget;
      const widgets = canvas.widgets.slice();
      widgets[idx] = updated;
      return {
        ok: true,
        previous,
        canvas: { ...canvas, version: canvas.version + 1, generated_at: now, widgets },
      };
    }
    case "remove_widget": {
      const { widget_id } = RemoveWidgetPayload.parse(action.payload);
      if (!canvas.widgets.some((w) => w.id === widget_id)) {
        return { ok: false, error: `widget ${widget_id} not found` };
      }
      return {
        ok: true,
        previous,
        canvas: {
          ...canvas,
          version: canvas.version + 1,
          generated_at: now,
          widgets: canvas.widgets.filter((w) => w.id !== widget_id),
        },
      };
    }
    case "mark_status": {
      const { widget_id, status } = MarkStatusPayload.parse(action.payload);
      const idx = canvas.widgets.findIndex((w) => w.id === widget_id);
      if (idx < 0) return { ok: false, error: `widget ${widget_id} not found` };
      const widgets = canvas.widgets.slice();
      widgets[idx] = { ...widgets[idx], status, updated_at: now };
      return {
        ok: true,
        previous,
        canvas: { ...canvas, version: canvas.version + 1, generated_at: now, widgets },
      };
    }
    case "add_evidence": {
      const { widget_id, text, source, confidence } = AddEvidencePayload.parse(action.payload);
      const idx = canvas.widgets.findIndex((w) => w.id === widget_id);
      if (idx < 0) return { ok: false, error: `widget ${widget_id} not found` };
      const widgets = canvas.widgets.slice();
      const target = widgets[idx];
      widgets[idx] = {
        ...target,
        evidence: [...target.evidence, { text, source, confidence, added_at: now }],
        sources: target.sources.some((s) => s.url === source.url)
          ? target.sources
          : [...target.sources, source],
        updated_at: now,
      };
      return {
        ok: true,
        previous,
        canvas: { ...canvas, version: canvas.version + 1, generated_at: now, widgets },
      };
    }
    case "propose_refresh": {
      // Refresh actions don't mutate canvas content directly. They produce a job
      // record (handled by the store). The reducer is a no-op for this kind.
      return { ok: true, previous, canvas };
    }
  }
}
