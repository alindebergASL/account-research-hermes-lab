import type {
  Canvas,
  CanvasWidget,
  MetricData,
  OpenQuestionsData,
  ActionPanelData,
  EvidenceBoardData,
  SectionRefData,
} from "./schema";

const ISO = "2026-05-01T12:00:00.000Z";

const sampleSource = {
  title: "Acme Health 2025 annual report",
  url: "https://example.com/acme/ar2025",
  accessed: "2026-04-30",
};

export const metricFixture: CanvasWidget = {
  id: "w_metric_1",
  kind: "metric",
  title: "Annual revenue",
  description: "Reported FY25 revenue.",
  source: "model",
  created_at: ISO,
  updated_at: ISO,
  confidence: "High",
  why_included: "Sizes the account; anchors investment thesis.",
  sources: [sampleSource],
  layout: { x: 0, y: 0, w: 3, h: 2, pinned: false, collapsed: false },
  controls: { can_refresh: true, can_remove: true, can_edit: true, can_export: false },
  status: "fresh",
  evidence: [
    {
      text: "Revenue of $1.24B for fiscal year ending Dec 2025.",
      source: sampleSource,
      added_at: ISO,
      confidence: "High",
    },
  ],
  data: { label: "Revenue (FY25)", value: "$1.24B", as_of: "2025-12-31", delta: "+8% YoY" } satisfies MetricData,
};

export const openQuestionsFixture: CanvasWidget = {
  id: "w_oq_1",
  kind: "open_questions",
  title: "Open questions",
  description: "Unresolved discovery questions.",
  source: "hermes",
  created_at: ISO,
  updated_at: ISO,
  confidence: "Medium",
  why_included: "Hermes flagged gaps in the current evidence base.",
  sources: [],
  layout: { x: 3, y: 0, w: 4, h: 3, pinned: false, collapsed: false },
  controls: { can_refresh: true, can_remove: true, can_edit: true, can_export: false },
  status: "fresh",
  evidence: [],
  data: {
    questions: [
      { text: "Who owns AI strategy after the recent CIO transition?", blocking: true },
      { text: "Is the Epic instance hosted or on-prem?", blocking: false, hypothesis: "Likely hosted given 2024 migration." },
    ],
  } satisfies OpenQuestionsData,
};

export const actionPanelFixture: CanvasWidget = {
  id: "w_actions_1",
  kind: "action_panel",
  title: "Recommended next steps",
  description: "Suggested actions for the account team.",
  source: "model",
  created_at: ISO,
  updated_at: ISO,
  confidence: "Medium",
  why_included: "Translates evidence into a near-term motion.",
  sources: [sampleSource],
  layout: { x: 7, y: 0, w: 5, h: 3, pinned: false, collapsed: false },
  controls: { can_refresh: false, can_remove: true, can_edit: true, can_export: false },
  status: "fresh",
  evidence: [],
  data: {
    actions: [
      {
        text: "Request intro to new VP Data via mutual on the board",
        why: "New exec, no relationship yet; window is open.",
        severity: "high",
      },
      {
        text: "Share the AI governance brief from the Q1 webinar",
        why: "They cited governance as the #1 blocker on the earnings call.",
        severity: "medium",
      },
    ],
  } satisfies ActionPanelData,
};

export const evidenceBoardFixture: CanvasWidget = {
  id: "w_evidence_1",
  kind: "evidence_board",
  title: "Recent signals",
  description: "Raw quotes and snippets from the last 90 days.",
  source: "model",
  created_at: ISO,
  updated_at: ISO,
  confidence: "High",
  why_included: "Primary evidence base for the rest of the canvas.",
  sources: [sampleSource],
  layout: { x: 0, y: 2, w: 7, h: 4, pinned: false, collapsed: false },
  controls: { can_refresh: true, can_remove: true, can_edit: true, can_export: true },
  status: "fresh",
  evidence: [],
  data: {
    snippets: [
      {
        text: "\"We are doubling our investment in clinical AI tooling in 2026.\" — CEO on Q4 earnings call",
        source: sampleSource,
        tag: "earnings",
      },
      {
        text: "Posted 3 senior ML engineer roles in the past 60 days.",
        source: {
          title: "Acme Health careers page",
          url: "https://example.com/acme/careers",
          accessed: "2026-04-29",
        },
        tag: "hiring",
      },
    ],
  } satisfies EvidenceBoardData,
};

export const sectionRefFixture: CanvasWidget = {
  id: "w_section_1",
  kind: "section_ref",
  title: "Legacy: Technical footprint",
  description: "Bridge into the existing brief's technical footprint section.",
  source: "system",
  created_at: ISO,
  updated_at: ISO,
  confidence: "Medium",
  why_included: "Preserves continuity with the legacy brief shape during lab.",
  sources: [],
  layout: { x: 7, y: 3, w: 5, h: 3, pinned: false, collapsed: false },
  controls: { can_refresh: false, can_remove: true, can_edit: false, can_export: false },
  status: "fresh",
  evidence: [],
  data: {
    section_key: "technical_footprint",
    preview: "Cloud: AWS primary, Azure secondary. Epic on Azure. Snowflake + Looker for analytics.",
  } satisfies SectionRefData,
};

export function demoCanvas(): Canvas {
  return {
    account_id: "acct_acme_health",
    account_name: "Acme Health",
    version: 1,
    generated_at: ISO,
    widgets: [
      metricFixture,
      openQuestionsFixture,
      actionPanelFixture,
      evidenceBoardFixture,
      sectionRefFixture,
    ],
    meta: { layout_mode: "grid", pinned_order: [] },
  };
}
