"use client";

import type { ZodSchema } from "zod";
import {
  ActionPanelData,
  CanvasWidget,
  EvidenceBoardData,
  MetricData,
  OpenQuestionsData,
  SectionRefData,
  WidgetKind,
} from "./schema";
import type { HermesActionKind } from "./actions";
import {
  ActionPanelTile,
  EvidenceBoardTile,
  MetricTile,
  OpenQuestionsTile,
  SectionRefTile,
} from "../../components/canvas/tiles";
import {
  ActionPanelDetail,
  EvidenceBoardDetail,
  MetricDetail,
  OpenQuestionsDetail,
  SectionRefDetail,
} from "../../components/canvas/details";
import {
  metricFixture,
  openQuestionsFixture,
  actionPanelFixture,
  evidenceBoardFixture,
  sectionRefFixture,
} from "./fixtures";

export interface WidgetDescriptor {
  kind: WidgetKind;
  label: string;
  icon: string; // lucide icon name, used by tiles
  dataSchema: ZodSchema<unknown>;
  Tile: React.FC<{ widget: CanvasWidget }>;
  Detail: React.FC<{ widget: CanvasWidget }>;
  fixture: CanvasWidget;
  allowedActions: HermesActionKind[];
  autoApplyActions: HermesActionKind[];
}

export const WIDGET_REGISTRY: Record<WidgetKind, WidgetDescriptor> = {
  metric: {
    kind: "metric",
    label: "Metric",
    icon: "Gauge",
    dataSchema: MetricData,
    Tile: MetricTile,
    Detail: MetricDetail,
    fixture: metricFixture,
    allowedActions: ["update_widget", "remove_widget", "add_evidence", "mark_status", "propose_refresh"],
    autoApplyActions: ["add_evidence", "mark_status"],
  },
  open_questions: {
    kind: "open_questions",
    label: "Open Questions",
    icon: "HelpCircle",
    dataSchema: OpenQuestionsData,
    Tile: OpenQuestionsTile,
    Detail: OpenQuestionsDetail,
    fixture: openQuestionsFixture,
    allowedActions: ["update_widget", "remove_widget", "add_evidence", "mark_status", "propose_refresh"],
    autoApplyActions: ["add_evidence", "mark_status"],
  },
  action_panel: {
    kind: "action_panel",
    label: "Action Panel",
    icon: "Target",
    dataSchema: ActionPanelData,
    Tile: ActionPanelTile,
    Detail: ActionPanelDetail,
    fixture: actionPanelFixture,
    allowedActions: ["update_widget", "remove_widget", "mark_status"],
    autoApplyActions: ["mark_status"],
  },
  evidence_board: {
    kind: "evidence_board",
    label: "Evidence Board",
    icon: "BookOpen",
    dataSchema: EvidenceBoardData,
    Tile: EvidenceBoardTile,
    Detail: EvidenceBoardDetail,
    fixture: evidenceBoardFixture,
    allowedActions: ["update_widget", "remove_widget", "add_evidence", "mark_status", "propose_refresh"],
    autoApplyActions: ["add_evidence", "mark_status"],
  },
  section_ref: {
    kind: "section_ref",
    label: "Section Reference",
    icon: "FileText",
    dataSchema: SectionRefData,
    Tile: SectionRefTile,
    Detail: SectionRefDetail,
    fixture: sectionRefFixture,
    allowedActions: ["remove_widget", "mark_status"],
    autoApplyActions: ["mark_status"],
  },
};

export const ALL_WIDGET_KINDS = Object.keys(WIDGET_REGISTRY) as WidgetKind[];

export function getDescriptor(kind: WidgetKind): WidgetDescriptor {
  return WIDGET_REGISTRY[kind];
}
