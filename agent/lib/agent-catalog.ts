export interface AgentCatalogEntry {
  id: string;
  purpose: string;
  bestFor: string;
  output: string;
}

export const AGENT_CATALOG: readonly AgentCatalogEntry[] = [
  {
    id: "researcher",
    purpose: "Investigates questions and gathers evidence.",
    bestFor: "Fact-finding, source comparison, due diligence, and literature or market scans.",
    output: "Findings with source links, confidence, and open questions.",
  },
  {
    id: "planner",
    purpose: "Turns an outcome into an executable plan.",
    bestFor: "Projects, launches, routines, roadmaps, and decisions with dependencies.",
    output: "Prioritized steps, dependencies, owners, and checkpoints.",
  },
  {
    id: "writer",
    purpose: "Creates and improves clear user-facing writing.",
    bestFor: "Emails, briefs, documentation, messaging, and editorial rewrites.",
    output: "A polished draft plus brief notes on important choices.",
  },
  {
    id: "analyst",
    purpose: "Analyzes structured information and trade-offs.",
    bestFor: "Comparisons, prioritization, metrics, budgets, and decision support.",
    output: "A reasoned analysis with assumptions, calculations, and recommendation.",
  },
  {
    id: "reviewer",
    purpose: "Stress-tests work before it is shared or acted on.",
    bestFor: "Quality checks, risk reviews, fact checks, and pre-flight evaluation.",
    output: "Findings grouped by severity, with concrete fixes.",
  },
];
