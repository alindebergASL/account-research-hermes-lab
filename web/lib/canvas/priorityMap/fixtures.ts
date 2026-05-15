import type { Brief } from "@/lib/schema";

// Representative account: a regional healthcare system in the middle of an AI
// program review. The fixture is hand-tuned so the deterministic derivation
// produces a useful spread of initiatives across the matrix.
export const acmeHealthBrief: Brief = {
  account_name: "Acme Regional Health",
  segment: "Healthcare",
  generated_at: "2026-05-01T12:00:00.000Z",
  audience: "internal",
  snapshot:
    "Multi-hospital system in the Pacific Northwest; $1.24B revenue; new CIO Janice Park six months in. AI investment doubling in 2026.",
  priority_summary:
    "Modernize the clinical AI stack; resolve governance ambiguity before scaling pilots; bring the new VP Data into the buying conversation.",
  recent_signals: [
    {
      text: "CEO on Q4 call: \"We are doubling our investment in clinical AI tooling in 2026.\"",
      source: "https://example.com/acme/q4-2025",
      confidence: "High",
    },
    {
      text: "Posted 3 senior ML engineer roles in the past 60 days, focused on clinical NLP.",
      source: "https://example.com/acme/careers",
      confidence: "High",
    },
    {
      text: "Janice Park keynote: \"AI governance is the blocker — we're standing up a committee in Q2.\"",
      source: "https://example.com/conf/keynote",
      confidence: "High",
    },
    {
      text: "RFP issued for ambient documentation pilot at three pilot hospitals.",
      source: "https://example.com/acme/rfp-ambient",
      confidence: "Medium",
    },
    {
      text: "Snowflake renewal coming up in Q3, exploring consolidation.",
      source: "https://example.com/acme/procurement",
      confidence: "Medium",
    },
  ],
  ai_tech_maturity: { rating: 3, rationale: "Pilots in production; no platform consolidation yet." },
  top_initiatives: [
    {
      title: "Clinical AI governance committee",
      detail:
        "CIO Janice Park is standing up a committee in Q2 to gate AI pilots. The committee will own model risk, clinical safety, and procurement signoff.",
      confidence: "High",
      source: "https://example.com/conf/keynote",
    },
    {
      title: "Ambient clinical documentation pilot",
      detail:
        "RFP out for ambient documentation at three pilot hospitals. VP Data Maria Chen owns the technical evaluation; the governance committee owns rollout.",
      confidence: "High",
      source: "https://example.com/acme/rfp-ambient",
    },
    {
      title: "Snowflake platform consolidation",
      detail:
        "Renewal coming Q3. The platform team is exploring consolidation onto Snowflake for analytics and clinical data; competing with Databricks. Data quality is a noted risk.",
      confidence: "Medium",
      source: "https://example.com/acme/procurement",
    },
    {
      title: "Clinical NLP hiring ramp",
      detail:
        "Three senior ML engineer roles for clinical NLP. Suggests an in-house build path; Maria Chen referenced this on the engineering all-hands.",
      confidence: "Medium",
      source: "https://example.com/acme/careers",
    },
    {
      title: "Patient portal modernization",
      detail:
        "Long-running stream; budget approved but vendor not selected. Lower urgency relative to clinical AI program. No clear executive owner.",
      confidence: "Low",
      source: "https://example.com/acme/portal",
    },
  ],
  technical_footprint: {
    ai_in_production: ["ambient documentation (limited)"],
    active_pilots: ["clinical NLP", "imaging triage"],
    cloud_platforms: ["AWS primary", "Azure secondary"],
    data_infrastructure: "Snowflake + Looker for analytics; clinical data on Epic.",
    clinical_platforms: "Epic on Azure",
    analytics_bi_stack: "Snowflake + Looker",
    build_vs_buy_posture: "buy with selective in-house augmentation",
    competitive_incumbents: ["Epic", "Nuance/DAX"],
  },
  programs_procurement: {
    modernization_grants: [],
    consortium_purchasing: [],
    active_rfps_contracts: ["ambient documentation pilot RFP"],
    ai_governance_policy: "in flight; committee Q2 2026",
    public_ai_use_cases: [],
  },
  personas: [
    {
      name: "Janice Park",
      title: "Chief Information Officer",
      priority: "Economic decision maker",
      opener: "Reference Q4 call commitment to doubling AI investment.",
      confidence: "High",
      source: "https://example.com/conf/keynote",
    },
    {
      name: "Maria Chen",
      title: "VP Data & AI",
      priority: "Technical champion",
      opener: "Ask about the ambient documentation evaluation criteria.",
      confidence: "High",
      source: "https://example.com/acme/about",
    },
    {
      name: "David Liu",
      title: "Chief Medical Information Officer",
      priority: "Clinical user / blocker",
      opener: "Discuss clinician adoption hurdles for ambient tooling.",
      confidence: "Medium",
      source: "https://example.com/acme/leadership",
    },
  ],
  buying_path:
    "Janice owns the budget; Maria runs the technical evaluation; David must sign off on clinician impact. Governance committee is gating.",
  first_angle:
    "Show Q4 call → governance plan → ambient RFP as one coherent program and align to it.",
  risks: [
    "Governance committee may delay procurement decisions through Q2.",
    "Clinical NLP hiring suggests in-house build — competes with our managed offering.",
    "Snowflake consolidation may freeze analytics decisions until Q3.",
    "Clinician adoption risk on ambient documentation if David Liu is not aligned.",
  ],
  competitive_signals: ["Nuance/DAX is incumbent for documentation."],
  next_action:
    "Brief Janice and Maria together on our AI governance partnership and ambient documentation references this quarter.",
  extensions: [],
  sources: [],
};
