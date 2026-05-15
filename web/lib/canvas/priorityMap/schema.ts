import { z } from "zod";

// Local re-declaration of the Confidence enum so this module has no dependency
// on the production Brief schema. The values must stay in lockstep with
// `web/lib/schema.ts`'s internal `Confidence` enum.
export const Confidence = z.enum(["High", "Medium", "Low", "Not found"]);
export type Confidence = z.infer<typeof Confidence>;

// A PriorityMap is purely derived data — nothing in it should be authored by
// hand for production. The derivation function (./derive.ts) is the single
// source of truth.
//
// This shape is intended to be the contract a future production
// `priority_map` widget kind would carry on Canvas. It is intentionally
// flat and JSON-serializable.

// Two axes on the 5x5 matrix. 0 = unknown, 1..5 = scored.
const Axis = z.number().int().min(0).max(5);

// One edge from an initiative to a related node. The kind is descriptive only,
// not behavioral.
export const RelationshipKind = z.enum(["persona", "risk", "signal", "next_action"]);
export type RelationshipKind = z.infer<typeof RelationshipKind>;

export const RelationshipEdge = z.object({
  kind: RelationshipKind,
  // Stable key identifying the target node (persona name, risk text hash, etc.).
  target_id: z.string().min(1),
  // Display label for the chip.
  label: z.string().min(1),
  // Why the edge was drawn (token match, name appearance, etc.). Required so a
  // reviewer can audit any derived edge without re-running the algorithm.
  evidence_text: z.string().min(1),
  // Confidence inherited from the linked node, if any.
  confidence: Confidence.optional(),
});
export type RelationshipEdge = z.infer<typeof RelationshipEdge>;

export const PriorityMapInitiative = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  detail: z.string().default(""),
  confidence: Confidence,
  source: z.string().default(""),
  impact: Axis,            // y-axis on the matrix
  urgency: Axis,           // x-axis on the matrix
  evidence_count: z.number().int().min(0),
  edges: z.array(RelationshipEdge),
});
export type PriorityMapInitiative = z.infer<typeof PriorityMapInitiative>;

export const PriorityMapNode = z.object({
  // Generic node container so the visual layer can render personas, risks,
  // and signals consistently (without re-walking the Brief).
  id: z.string().min(1),
  label: z.string().min(1),
  kind: RelationshipKind,
  confidence: Confidence.optional(),
  meta: z.record(z.string(), z.string()).default({}),
});
export type PriorityMapNode = z.infer<typeof PriorityMapNode>;

export const PriorityMap = z.object({
  account_name: z.string(),
  generated_at: z.string(),
  initiatives: z.array(PriorityMapInitiative),
  // Side index of all related nodes referenced by edges. Lets the visual layer
  // render the relationship panel without scanning the source Brief.
  nodes: z.array(PriorityMapNode),
  // The original next_action string, attached so the UI can highlight the
  // initiative(s) it supports.
  next_action: z.string().default(""),
  // Diagnostics — how many of each derived field came back populated.
  diagnostics: z.object({
    initiative_count: z.number().int().min(0),
    edge_count: z.number().int().min(0),
    persona_link_count: z.number().int().min(0),
    risk_link_count: z.number().int().min(0),
    signal_link_count: z.number().int().min(0),
    next_action_link_count: z.number().int().min(0),
  }),
});
export type PriorityMap = z.infer<typeof PriorityMap>;
