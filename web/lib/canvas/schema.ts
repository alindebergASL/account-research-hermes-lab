import { z } from "zod";

export const Confidence = z.enum(["High", "Medium", "Low", "Not found"]);
export type Confidence = z.infer<typeof Confidence>;

export const Source = z.object({
  title: z.string().min(1),
  url: z.string().min(1),
  accessed: z.string().min(1),
});
export type Source = z.infer<typeof Source>;

export const WidgetKind = z.enum([
  "metric",
  "open_questions",
  "action_panel",
  "evidence_board",
  "section_ref",
]);
export type WidgetKind = z.infer<typeof WidgetKind>;

export const WidgetSource = z.enum(["model", "research", "chat", "user", "system", "refresh", "hermes"]);
export type WidgetSource = z.infer<typeof WidgetSource>;

export const WidgetStatus = z.enum(["fresh", "stale", "watching", "archived"]);
export type WidgetStatus = z.infer<typeof WidgetStatus>;

export const WidgetLayout = z.object({
  x: z.number().int().min(0),
  y: z.number().int().min(0),
  w: z.number().int().min(1).max(12),
  h: z.number().int().min(1).max(24),
  pinned: z.boolean().default(false),
  collapsed: z.boolean().default(false),
});
export type WidgetLayout = z.infer<typeof WidgetLayout>;

export const WidgetControls = z.object({
  can_refresh: z.boolean().default(false),
  can_remove: z.boolean().default(true),
  can_edit: z.boolean().default(true),
  can_export: z.boolean().default(false),
});
export type WidgetControls = z.infer<typeof WidgetControls>;

export const Evidence = z.object({
  text: z.string().min(1),
  source: Source,
  added_at: z.string(),
  confidence: Confidence,
});
export type Evidence = z.infer<typeof Evidence>;

// Per-kind data schemas
export const MetricData = z.object({
  label: z.string().min(1),
  value: z.string().min(1),
  unit: z.string().optional(),
  as_of: z.string().optional(),
  delta: z.string().optional(),
});
export type MetricData = z.infer<typeof MetricData>;

export const OpenQuestionsData = z.object({
  questions: z
    .array(
      z.object({
        text: z.string().min(1),
        blocking: z.boolean().default(false),
        hypothesis: z.string().optional(),
      }),
    )
    .min(1),
});
export type OpenQuestionsData = z.infer<typeof OpenQuestionsData>;

export const ActionPanelData = z.object({
  actions: z
    .array(
      z.object({
        text: z.string().min(1),
        why: z.string().min(1),
        owner: z.string().optional(),
        severity: z.enum(["low", "medium", "high"]).default("medium"),
      }),
    )
    .min(1),
});
export type ActionPanelData = z.infer<typeof ActionPanelData>;

export const EvidenceBoardData = z.object({
  snippets: z
    .array(
      z.object({
        text: z.string().min(1),
        source: Source,
        tag: z.string().optional(),
      }),
    )
    .min(1),
});
export type EvidenceBoardData = z.infer<typeof EvidenceBoardData>;

export const SectionRefData = z.object({
  section_key: z.string().min(1),
  preview: z.string().default(""),
});
export type SectionRefData = z.infer<typeof SectionRefData>;

// Discriminated widget union by kind
const WidgetBase = {
  id: z.string().min(1),
  // Optional idempotency key. When two append_widget actions carry the same
  // `idem_key`, the reducer treats the second as a no-op rather than appending
  // a duplicate. Lets Hermes safely retry a flaky proposal without producing
  // duplicate tiles.
  idem_key: z.string().min(1).optional(),
  title: z.string().min(1),
  description: z.string().default(""),
  source: WidgetSource,
  created_at: z.string(),
  updated_at: z.string(),
  confidence: Confidence,
  why_included: z.string().default(""),
  sources: z.array(Source).default([]),
  layout: WidgetLayout,
  controls: WidgetControls,
  status: WidgetStatus.default("fresh"),
  evidence: z.array(Evidence).default([]),
};

export const MetricWidget = z.object({ ...WidgetBase, kind: z.literal("metric"), data: MetricData });
export const OpenQuestionsWidget = z.object({
  ...WidgetBase,
  kind: z.literal("open_questions"),
  data: OpenQuestionsData,
});
export const ActionPanelWidget = z.object({
  ...WidgetBase,
  kind: z.literal("action_panel"),
  data: ActionPanelData,
});
export const EvidenceBoardWidget = z.object({
  ...WidgetBase,
  kind: z.literal("evidence_board"),
  data: EvidenceBoardData,
});
export const SectionRefWidget = z.object({
  ...WidgetBase,
  kind: z.literal("section_ref"),
  data: SectionRefData,
});

export const CanvasWidget = z.discriminatedUnion("kind", [
  MetricWidget,
  OpenQuestionsWidget,
  ActionPanelWidget,
  EvidenceBoardWidget,
  SectionRefWidget,
]);
export type CanvasWidget = z.infer<typeof CanvasWidget>;

export const Canvas = z.object({
  account_id: z.string().min(1),
  account_name: z.string().min(1),
  version: z.number().int(),
  generated_at: z.string(),
  widgets: z.array(CanvasWidget),
  meta: z
    .object({
      layout_mode: z.enum(["grid", "freeform"]).default("grid"),
      pinned_order: z.array(z.string()).default([]),
    })
    .default({ layout_mode: "grid", pinned_order: [] }),
});
export type Canvas = z.infer<typeof Canvas>;
