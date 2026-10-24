/**
 * The fraud-claim rule registry from the legislative reference pack (`legislative-reference/`):
 * 35 rules across Reg E, Reg Z, UCC 4A, checks, Nacha, P2P networks and intake compliance, each
 * with its trigger, required facts, obligation, exceptions, deadline and human-review trigger.
 *
 * It is RESEARCH REFERENCE DATA, not legal advice and not a rule engine. The reasoning model reads
 * it to decide what information a case still needs and which investigative work matters for the
 * claim type it is considering. Nothing here decides a claim. Legal readings still cite only the
 * curated sources in regulatory.ts.
 *
 * The data module (ruleRegistryData.ts) is generated from the CSV by `npm run build:rules`;
 * tests/ruleRegistry.test.ts fails if the two drift apart. Fact IDs (F01–F42) refer to the pack's
 * caller fact checklist, which isn't in the repo yet, so they are passed through as IDs only.
 */
import { RULE_REGISTRY } from "./ruleRegistryData";

export interface RegistryRule {
  rule_id: string;
  rule: string;
  source_pinpoint: string;
  source_ids: string;
  claim_type: string;
  payment_rail: string;
  legal_trigger: string;
  required_facts: string;
  obligation: string;
  exceptions: string;
  deadline: string;
  clock_start: string;
  calendar_vs_business_days: string;
  extension_rules: string;
  human_review_trigger: string;
  uncertainty: string;
}

export const REGISTRY_RULE_IDS: ReadonlySet<string> = new Set(RULE_REGISTRY.map((r) => r.rule_id));

/** RFC 4180 CSV: quoted fields may hold commas, doubled quotes and newlines. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      field = "";
      if (row.some((f) => f !== "")) rows.push(row);
      row = [];
    } else field += c;
  }
  row.push(field);
  if (row.some((f) => f !== "")) rows.push(row);
  return rows;
}

export function rulesFromCsv(text: string): RegistryRule[] {
  const [header, ...rows] = parseCsv(text.replace(/^﻿/, ""));
  if (!header) return [];
  return rows.map((cells) => Object.fromEntries(header.map((h, i) => [h, (cells[i] ?? "").trim()])) as unknown as RegistryRule);
}

/** The claim type the case currently points to, from what the customer has said so far. */
export type ClaimLean = "unauthorized" | "scam_induced" | "unknown";

const INDEX_ONLY_PREFIXES = ["R-W", "R-K", "R-F"];
const PIVOT_RULES = new Set(["R-E01", "R-E02", "R-E03"]);

const shorten = (s: string, max: number) => (s.length > max ? `${s.slice(0, max - 1)}…` : s);

/**
 * What the model gets: a one-line index of every case rule, plus detail for the rules that fit the
 * claim type the case leans towards (while it's unknown, the shared rules and the rules that tell
 * the two kinds apart). Wire, check and brokerage rules stay in the index only, and intake-compliance
 * rules (about the call itself) are left out. Long fields are shortened to keep the prompt small.
 */
export function referenceRulesFor(lean: ClaimLean): {
  note: string;
  index: { id: string; rule: string; claimType: string; rail: string }[];
  detail: { id: string; rule: string; rail: string; trigger: string; requiredFacts: string; obligation: string; exceptions: string; deadline: string; humanReview: string; uncertainty: string }[];
} {
  const caseRules = RULE_REGISTRY.filter((r) => r.claim_type !== "Intake compliance");
  const fits = (r: RegistryRule) => {
    // Wires, checks and brokerage are outside this product's scope (they go to a specialist): index only.
    if (INDEX_ONLY_PREFIXES.some((p) => r.rule_id.startsWith(p))) return false;
    const t = r.claim_type;
    if (t.startsWith("Both")) return true;
    // Until the customer says who sent it, only the rules that tell the two kinds apart are sent in detail.
    if (lean === "unknown") return PIVOT_RULES.has(r.rule_id);
    return lean === "unauthorized" ? t.startsWith("Unauthorized") : t.startsWith("Scam-induced");
  };
  return {
    note: "Research reference (legislative-reference/), not legal advice. Use it to decide what facts are still needed and what work matters. Fact IDs (F..) refer to a checklist not provided.",
    index: caseRules.map((r) => ({ id: r.rule_id, rule: shorten(r.rule, 80), claimType: r.claim_type, rail: shorten(r.payment_rail, 40) })),
    detail: caseRules
      .filter(fits)
      .map((r) => ({
        id: r.rule_id,
        rule: r.rule,
        rail: shorten(r.payment_rail, 80),
        trigger: shorten(r.legal_trigger, 200),
        requiredFacts: r.required_facts,
        obligation: shorten(r.obligation, 240),
        exceptions: shorten(r.exceptions, 160),
        deadline: shorten(r.deadline, 120),
        humanReview: shorten(r.human_review_trigger, 140),
        uncertainty: shorten(r.uncertainty, 120),
      })),
  };
}

export function getRegistryRule(id: string): RegistryRule | undefined {
  return RULE_REGISTRY.find((r) => r.rule_id === id);
}
