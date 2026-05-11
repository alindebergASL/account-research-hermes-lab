import type { HermesAction } from "./actions";
import type { Canvas, CanvasWidget } from "./schema";

// Deterministic fake-Hermes composer.
//
// Emits canned typed proposals that exercise:
//   - safe additive actions (auto-apply)
//   - risky/destructive actions (confirm flow)
//   - propose_refresh (always confirm)
//
// No API calls. No randomness. Same input → same output, so the demo is repeatable.

export type FakeHermesPromptId =
  | "scan_for_metric"
  | "add_open_question"
  | "add_evidence_to_first"
  | "propose_remove_section_ref"
  | "propose_refresh_evidence_board"
  | "propose_action_panel";

export interface FakeHermesPrompt {
  id: FakeHermesPromptId;
  label: string;
  description: string;
  expectedDecision: "auto_applied" | "queued";
}

export const FAKE_HERMES_PROMPTS: FakeHermesPrompt[] = [
  {
    id: "scan_for_metric",
    label: "Scan for a new metric",
    description: "Propose adding a Headcount metric. Safe additive → auto-applies.",
    expectedDecision: "auto_applied",
  },
  {
    id: "add_open_question",
    label: "Add an open question",
    description: "Append a new open_questions widget. Safe additive → auto-applies.",
    expectedDecision: "auto_applied",
  },
  {
    id: "add_evidence_to_first",
    label: "Add evidence to first widget",
    description: "Adds an evidence snippet to the first widget. Auto-applies.",
    expectedDecision: "auto_applied",
  },
  {
    id: "propose_action_panel",
    label: "Propose a new action panel",
    description: "Risky additive (changes sales motion) → requires approval.",
    expectedDecision: "queued",
  },
  {
    id: "propose_remove_section_ref",
    label: "Propose removing a section reference",
    description: "Destructive → requires approval.",
    expectedDecision: "queued",
  },
  {
    id: "propose_refresh_evidence_board",
    label: "Propose refreshing the evidence board",
    description: "Costs money / hits external sources → requires approval.",
    expectedDecision: "queued",
  },
];

const stockSource = {
  title: "Acme Health Q1 earnings call transcript",
  url: "https://example.com/acme/q1-2026",
  accessed: "2026-05-09",
};

type Draft = Omit<HermesAction, "id" | "state" | "proposed_at">;

export function buildProposal(promptId: FakeHermesPromptId, canvas: Canvas): Draft | { error: string } {
  switch (promptId) {
    case "scan_for_metric": {
      const widget: CanvasWidget = {
        id: `w_metric_hc_${canvas.version}`,
        kind: "metric",
        title: "Headcount",
        description: "Reported on the Q1 earnings call.",
        source: "hermes",
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        confidence: "High",
        why_included: "Sizing signal; growing 12% YoY.",
        sources: [stockSource],
        layout: { x: 0, y: 6, w: 3, h: 2, pinned: false, collapsed: false },
        controls: { can_refresh: true, can_remove: true, can_edit: true, can_export: false },
        status: "fresh",
        evidence: [
          { text: "Headcount reported as 4,300 in Q1 2026 call.", source: stockSource, added_at: new Date().toISOString(), confidence: "High" },
        ],
        data: { label: "Headcount", value: "4,300", as_of: "2026-03-31", delta: "+12% YoY" },
      };
      return {
        kind: "append_widget",
        payload: { widget },
        rationale: "Q1 earnings call reported headcount; useful sizing metric.",
        evidence: [stockSource],
        proposed_by: "hermes",
        confidence: "High",
      };
    }
    case "add_open_question": {
      const widget: CanvasWidget = {
        id: `w_oq_followup_${canvas.version}`,
        kind: "open_questions",
        title: "Follow-up questions",
        description: "Hermes flagged these from the Q1 transcript.",
        source: "hermes",
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        confidence: "Medium",
        why_included: "Gaps Hermes noticed after parsing the call transcript.",
        sources: [stockSource],
        layout: { x: 3, y: 6, w: 4, h: 3, pinned: false, collapsed: false },
        controls: { can_refresh: true, can_remove: true, can_edit: true, can_export: false },
        status: "fresh",
        evidence: [],
        data: {
          questions: [
            { text: "What is the AI governance committee charter post-restructuring?", blocking: true },
            { text: "Is the platform team consolidating onto a single MLOps stack?", blocking: false },
          ],
        },
      };
      return {
        kind: "append_widget",
        payload: { widget },
        rationale: "Open questions surfaced from Q1 transcript.",
        evidence: [stockSource],
        proposed_by: "hermes",
        confidence: "Medium",
      };
    }
    case "add_evidence_to_first": {
      const first = canvas.widgets[0];
      if (!first) return { error: "no widgets to attach evidence to" };
      return {
        kind: "add_evidence",
        payload: {
          widget_id: first.id,
          text: "Reaffirmed in Q1 2026 earnings call.",
          source: stockSource,
          confidence: "High",
        },
        rationale: "Latest earnings call reaffirms the figure.",
        evidence: [stockSource],
        proposed_by: "hermes",
        confidence: "High",
      };
    }
    case "propose_action_panel": {
      const widget: CanvasWidget = {
        id: `w_actions_proposed_${canvas.version}`,
        kind: "action_panel",
        title: "Proposed motion: post-earnings outreach",
        description: "Hermes-drafted action plan.",
        source: "hermes",
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        confidence: "Medium",
        why_included: "Translates earnings signals into immediate plays.",
        sources: [stockSource],
        layout: { x: 7, y: 6, w: 5, h: 3, pinned: false, collapsed: false },
        controls: { can_refresh: false, can_remove: true, can_edit: true, can_export: false },
        status: "fresh",
        evidence: [],
        data: {
          actions: [
            { text: "Send congratulatory note referencing Q1 AI investment line", why: "Cite their CEO's specific language.", severity: "medium" },
            { text: "Re-engage VP Eng on platform consolidation", why: "Hiring pattern suggests stack decisions are imminent.", severity: "high" },
          ],
        },
      };
      return {
        kind: "append_widget",
        payload: { widget },
        rationale: "Action panels influence sales motion — propose, don't apply.",
        evidence: [stockSource],
        proposed_by: "hermes",
        confidence: "Medium",
      };
    }
    case "propose_remove_section_ref": {
      const target = canvas.widgets.find((w) => w.kind === "section_ref");
      if (!target) return { error: "no section_ref widget to remove" };
      return {
        kind: "remove_widget",
        payload: { widget_id: target.id },
        rationale: "Legacy section reference is duplicated by newer widgets.",
        evidence: [stockSource],
        proposed_by: "hermes",
        confidence: "Medium",
      };
    }
    case "propose_refresh_evidence_board": {
      const target = canvas.widgets.find((w) => w.kind === "evidence_board");
      if (!target) return { error: "no evidence_board to refresh" };
      return {
        kind: "propose_refresh",
        payload: { widget_id: target.id, scope: "widget", reason: "Last refresh 30+ days ago." },
        rationale: "Evidence board likely stale; refresh hits external sources.",
        evidence: [],
        proposed_by: "hermes",
        confidence: "Medium",
      };
    }
  }
}
