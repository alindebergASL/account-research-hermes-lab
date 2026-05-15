import type { Brief, Initiative, Persona, Signal } from "@/lib/schema";
import type {
  PriorityMap,
  PriorityMapInitiative,
  PriorityMapNode,
  RelationshipEdge,
} from "./schema";

// Pure deterministic derivation of a PriorityMap from a Brief.
//
// No randomness. No network. No clock dependency beyond `brief.generated_at`,
// which is copied through. Same input → byte-identical output (modulo Brief
// ordering, which is preserved).
//
// Scoring rules are intentionally explicit and conservative:
//   - confidence buckets the impact floor: High=3, Medium=2, Low=1, Not found=0
//   - persona/risk/signal token overlap bumps impact and urgency
//   - urgency floors at 1 for any initiative whose confidence is not "Not found"
//
// Production should treat this function as a starting point and not hardcode
// the weights. The shape it produces, however, is intended to be the stable
// contract.

const CONF_WEIGHT: Record<string, number> = {
  High: 3,
  Medium: 2,
  Low: 1,
  "Not found": 0,
};

const STOPWORDS = new Set([
  "the", "a", "an", "and", "or", "of", "for", "to", "in", "on", "with",
  "by", "from", "as", "is", "are", "was", "were", "be", "been", "being",
  "at", "we", "our", "their", "they", "it", "this", "that", "into", "across",
  "ai", "data", "platform", "team", "new", "modern", "key", "next",
]);

function tokens(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter((t) => t.length > 2 && !STOPWORDS.has(t)),
  );
}

function overlap(a: Set<string>, b: Set<string>): number {
  let n = 0;
  for (const t of a) if (b.has(t)) n++;
  return n;
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}

function personaPriorityWeight(priority: string): number {
  // Personas don't carry a numeric priority field; the brief's `priority`
  // is free-form text. We bucket common values.
  const p = (priority || "").toLowerCase();
  if (p.includes("decision") || p.includes("economic")) return 2;
  if (p.includes("champion") || p.includes("influenc")) return 1.5;
  if (p.includes("user") || p.includes("blocker")) return 1;
  return 0.5;
}

function initiativeId(i: Initiative, idx: number): string {
  const base = slug(i.title);
  return base.length > 0 ? `i_${base}` : `i_${idx}`;
}

function personaId(p: Persona): string {
  return `p_${slug(p.name)}`;
}

function signalId(s: Signal, idx: number): string {
  return `s_${idx}_${slug(s.text).slice(0, 24)}`;
}

function riskId(r: string, idx: number): string {
  return `r_${idx}_${slug(r).slice(0, 24)}`;
}

export function derivePriorityMap(brief: Brief): PriorityMap {
  const initiatives: PriorityMapInitiative[] = [];
  const nodeIndex = new Map<string, PriorityMapNode>();

  function addNode(node: PriorityMapNode) {
    if (!nodeIndex.has(node.id)) nodeIndex.set(node.id, node);
  }

  // Pre-tokenize related nodes once.
  const personaTokens = brief.personas.map((p) => ({
    persona: p,
    toks: tokens(`${p.name} ${p.title} ${p.opener}`),
    nameToks: tokens(p.name),
  }));

  const signalTokens = brief.recent_signals.map((s, idx) => ({
    signal: s,
    idx,
    toks: tokens(s.text),
  }));

  const riskTokens = brief.risks.map((r, idx) => ({
    risk: r,
    idx,
    toks: tokens(r),
  }));

  const nextActionToks = tokens(brief.next_action || "");

  let personaLinkCount = 0;
  let riskLinkCount = 0;
  let signalLinkCount = 0;
  let nextActionLinkCount = 0;

  brief.top_initiatives.forEach((init, idx) => {
    const id = initiativeId(init, idx);
    const initToks = tokens(`${init.title} ${init.detail}`);
    const titleToks = tokens(init.title);

    const edges: RelationshipEdge[] = [];
    let personaScore = 0;

    // Initiative → persona: name appearance in detail OR strong token overlap.
    for (const { persona, toks: ptoks, nameToks } of personaTokens) {
      const nameMatch = overlap(initToks, nameToks);
      const tokenMatch = overlap(initToks, ptoks);
      if (nameMatch > 0 || tokenMatch >= 2) {
        personaScore += personaPriorityWeight(persona.priority);
        const pid = personaId(persona);
        edges.push({
          kind: "persona",
          target_id: pid,
          label: persona.name,
          evidence_text: nameMatch > 0
            ? `name "${persona.name}" appears in initiative text`
            : `${tokenMatch} keyword(s) overlap with persona profile`,
          confidence: persona.confidence,
        });
        addNode({
          id: pid,
          label: `${persona.name}, ${persona.title}`,
          kind: "persona",
          confidence: persona.confidence,
          meta: { priority: persona.priority },
        });
        personaLinkCount++;
      }
    }

    // Initiative → risk: token overlap.
    for (const { risk, idx: ridx, toks: rtoks } of riskTokens) {
      const m = overlap(initToks, rtoks);
      if (m >= 1) {
        const rid = riskId(risk, ridx);
        edges.push({
          kind: "risk",
          target_id: rid,
          label: risk.length > 60 ? risk.slice(0, 57) + "…" : risk,
          evidence_text: `${m} keyword(s) overlap with risk text`,
        });
        addNode({
          id: rid,
          label: risk,
          kind: "risk",
          meta: {},
        });
        riskLinkCount++;
      }
    }

    // Initiative → signal: token overlap (titleToks for tightness).
    let signalMatchCount = 0;
    for (const { signal, idx: sidx, toks: stoks } of signalTokens) {
      const m = overlap(titleToks, stoks);
      if (m >= 1) {
        const sid = signalId(signal, sidx);
        edges.push({
          kind: "signal",
          target_id: sid,
          label: signal.text.length > 80 ? signal.text.slice(0, 77) + "…" : signal.text,
          evidence_text: `${m} keyword(s) overlap with signal text`,
          confidence: signal.confidence,
        });
        addNode({
          id: sid,
          label: signal.text,
          kind: "signal",
          confidence: signal.confidence,
          meta: { source: signal.source },
        });
        signalLinkCount++;
        signalMatchCount++;
      }
    }

    // Initiative → next_action: token overlap with the brief's next_action.
    const nextOverlap = overlap(initToks, nextActionToks);
    if (nextOverlap >= 1 && brief.next_action) {
      const nid = `na_${idx}`;
      edges.push({
        kind: "next_action",
        target_id: nid,
        label: brief.next_action.length > 80 ? brief.next_action.slice(0, 77) + "…" : brief.next_action,
        evidence_text: `${nextOverlap} keyword(s) overlap with the brief's next action`,
      });
      addNode({
        id: nid,
        label: brief.next_action,
        kind: "next_action",
        meta: {},
      });
      nextActionLinkCount++;
    }

    // Score axes.
    const confFloor = CONF_WEIGHT[init.confidence] ?? 0;
    const impact = clamp(Math.round(confFloor + Math.min(personaScore, 2.5)), 0, 5);
    const urgencyBase = confFloor === 0 ? 0 : 1;
    const urgency = clamp(urgencyBase + Math.min(signalMatchCount, 4), 0, 5);

    // Evidence count: signals + persona + risk edges (rough proxy until
    // production wires real Source counts per initiative).
    const evidenceCount = edges.length;

    initiatives.push({
      id,
      title: init.title,
      detail: init.detail,
      confidence: init.confidence,
      source: init.source,
      impact,
      urgency,
      evidence_count: evidenceCount,
      edges,
    });
  });

  const nodes = Array.from(nodeIndex.values()).sort((a, b) => a.id.localeCompare(b.id));

  return {
    account_name: brief.account_name,
    generated_at: brief.generated_at,
    initiatives,
    nodes,
    next_action: brief.next_action || "",
    diagnostics: {
      initiative_count: initiatives.length,
      edge_count: initiatives.reduce((n, i) => n + i.edges.length, 0),
      persona_link_count: personaLinkCount,
      risk_link_count: riskLinkCount,
      signal_link_count: signalLinkCount,
      next_action_link_count: nextActionLinkCount,
    },
  };
}
