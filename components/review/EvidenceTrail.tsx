"use client";

/**
 * Evidence trail: each reported fact, the statement it came from, the selected bank record, and
 * how they relate. The relation column only restates the rule-based matcher's own reasons and
 * contradictions; nothing is inferred here. Facts the bank record cannot show are marked as
 * customer-reported only.
 */
import type { ReactNode } from "react";
import type { StoredAnalysis } from "@/lib/domain/triage";
import type { MatchCandidate } from "@/lib/domain/matching";
import { RefChip } from "./EvidenceRef";
import { RECONCILIATION_LABEL, reconciliation } from "@/lib/review/workspace";
import { CREDENTIALS_LABEL, POSITION_LABEL, usd } from "./format";
import type { Payment } from "./types";

type Relation = "consistent" | "approximate" | "differs" | "conflict" | "reported_only" | "not_reported" | "no_record";

const RELATION: Record<Relation, { mark: string; label: string }> = {
  consistent: { mark: "✓", label: "Consistent" },
  approximate: { mark: "≈", label: "Approximate" },
  differs: { mark: "≠", label: "Differs" },
  conflict: { mark: "⚠", label: "Statements disagree" },
  reported_only: { mark: "○", label: "Customer report only" },
  not_reported: { mark: "–", label: "Not reported" },
  no_record: { mark: "?", label: "No record to compare" },
};

interface Row {
  field: string;
  reported: { value: string; ref: string }[];
  bank: ReactNode;
  relation: Relation;
  detail?: string;
  detailRefs?: string[];
  corrections?: { ref: string; by: string }[];
}

type MatchField = "amount" | "date" | "merchant";

function compare(field: MatchField, hasReported: boolean, candidate: MatchCandidate | null, hasRecord: boolean): Pick<Row, "relation" | "detail" | "detailRefs"> {
  if (!hasReported) return { relation: "not_reported" };
  if (!hasRecord || !candidate) return { relation: "no_record" };
  const reason = candidate.reasons.find((r) => r.field === field);
  const contradiction = candidate.contradictions.find((c) => (field === "amount" ? /^amount/.test(c) : field === "date" ? /date/.test(c) : /merchant/.test(c)));
  if (reason && contradiction) return { relation: "approximate", detail: reason.detail, detailRefs: [reason.statementRef] };
  if (reason) return { relation: "consistent", detail: reason.detail, detailRefs: [reason.statementRef] };
  if (contradiction) return { relation: "differs", detail: contradiction };
  return { relation: "differs", detail: `The record's ${field} does not match what the customer reported.` };
}

export function EvidenceTrail({ analysis, payment, paymentCount }: { analysis: StoredAnalysis | null; payment: Payment | null; paymentCount: number }) {
  const facts = analysis?.facts;
  if (!facts) {
    return (
      <section id="trail" className="ws-section" aria-labelledby="trail-h">
        <h2 id="trail-h">Payments and evidence</h2>
        <p className="ws-muted">No analysis yet.</p>
      </section>
    );
  }
  const conflictFor = (f: string) => facts.conflicts.find((c) => c.field === f);
  const correctionsFor = (f: string) => facts.superseded.filter((s) => s.fields.includes(f)).map((s) => ({ ref: s.ref, by: s.by }));
  const cand = payment?.candidate ?? null;
  const hasRecord = !!payment;

  const withConflict = (field: string, row: Row): Row => {
    const c = conflictFor(field);
    if (!c) return row;
    const show = (v: string) => (field === "amount" ? usd(Number(v)) : field === "authorization" ? POSITION_LABEL[v] ?? v : field === "credentialSharing" ? CREDENTIALS_LABEL[v] ?? v : v);
    return { ...row, relation: "conflict", detail: c.values.map((v) => `${v.statementRef}: ${show(v.value)}`).join(" vs "), detailRefs: [...new Set(c.values.map((v) => v.statementRef))] };
  };

  const rows: Row[] = [
    withConflict("amount", {
      field: "Amount",
      reported: facts.amounts.map((a) => ({ value: usd(a.value), ref: a.statementRef })),
      bank: payment ? usd(payment.amount) : null,
      ...compare("amount", facts.amounts.length > 0, cand, hasRecord),
      corrections: correctionsFor("amounts"),
    }),
    withConflict("date", {
      field: "Date",
      reported: facts.dates.map((d) => ({ value: d.value, ref: d.statementRef })),
      bank: payment ? payment.date ?? "unknown" : null,
      ...compare("date", facts.dates.length > 0, cand, hasRecord),
      corrections: correctionsFor("dates"),
    }),
    {
      field: "Payee",
      reported: facts.merchantTerms.map((m) => ({ value: m.value, ref: m.statementRef })),
      bank: payment ? payment.merchant ?? "unknown" : null,
      ...compare("merchant", facts.merchantTerms.length > 0, cand, hasRecord),
      corrections: correctionsFor("merchantTerms"),
    },
    withConflict("authorization", {
      field: "Who sent it",
      reported: facts.authorization ? [{ value: POSITION_LABEL[facts.authorization.value] ?? facts.authorization.value, ref: facts.authorization.statementRef }] : [],
      bank: <span className="ws-muted">Not in bank records</span>,
      relation: facts.authorization ? "reported_only" : "not_reported",
      corrections: correctionsFor("authorization"),
    }),
    withConflict("credentialSharing", {
      field: "Codes or details shared",
      reported: facts.credentialSharing ? [{ value: CREDENTIALS_LABEL[facts.credentialSharing.value] ?? facts.credentialSharing.value, ref: facts.credentialSharing.statementRef }] : [],
      bank: <span className="ws-muted">Not in bank records</span>,
      relation: facts.credentialSharing ? "reported_only" : "not_reported",
      corrections: correctionsFor("credentialSharing"),
    }),
    {
      field: "Scam signs mentioned",
      reported: facts.scamIndicators.map((s) => ({ value: s.value, ref: s.statementRef })),
      bank: <span className="ws-muted">Not in bank records</span>,
      relation: facts.scamIndicators.length ? "reported_only" : "not_reported",
    },
  ];
  const confirmation = cand?.reasons.find((r) => r.field === "customer_confirmation");
  const rec = payment ? reconciliation(analysis, payment.ref).state : null;

  return (
    <section id="trail" className="ws-section" aria-labelledby="trail-h">
      <div className="ws-section-head">
        <h2 id="trail-h">Payments and evidence {rec && <span className={`ws-tag ws-recon-${rec}`}>{RECONCILIATION_LABEL[rec]}</span>}</h2>
        <p className="ws-muted ws-small">
          What the customer reported, where they said it, and how it compares with{" "}
          {payment ? <>bank record <RefChip refId={payment.ref} /></> : "a bank record (none selected)"}
          {paymentCount > 1 && " — switch payments in the left column"}. Hover or focus a reference to highlight its source.
        </p>
      </div>
      <div className="ws-table-wrap">
        <table className="ws-table ws-trail">
          <thead>
            <tr>
              <th scope="col">Fact</th>
              <th scope="col">Customer account <span className="ws-muted">(reported)</span></th>
              <th scope="col">Bank record <span className="ws-muted">(observed)</span></th>
              <th scope="col">Reconciliation <span className="ws-muted">(rule-based)</span></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.field} data-relation={r.relation}>
                <th scope="row">{r.field}</th>
                <td>
                  {r.reported.length === 0 ? (
                    <span className="ws-muted">—</span>
                  ) : (
                    <ul className="ws-vals">
                      {r.reported.map((v) => (
                        <li key={`${v.ref}-${v.value}`}>
                          {v.value} <RefChip refId={v.ref} />
                        </li>
                      ))}
                    </ul>
                  )}
                  {r.corrections && r.corrections.length > 0 && (
                    <div className="ws-small ws-muted">
                      {r.corrections.map((c) => (
                        <span key={`${c.ref}-${c.by}`}>
                          <RefChip refId={c.ref} /> corrected by <RefChip refId={c.by} />{" "}
                        </span>
                      ))}
                    </div>
                  )}
                </td>
                <td className="ws-num-cell">{r.bank ?? <span className="ws-muted">—</span>}</td>
                <td>
                  <span className={`ws-rel ws-rel-${r.relation}`}>
                    <span aria-hidden="true">{RELATION[r.relation].mark}</span> {RELATION[r.relation].label}
                  </span>
                  {r.detail && <div className="ws-small ws-muted">{r.detail}</div>}
                  {r.detailRefs && r.detailRefs.length > 0 && r.relation === "conflict" && (
                    <div className="ws-small">{r.detailRefs.map((ref) => <RefChip key={ref} refId={ref} />)}</div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {confirmation && (
        <p className="ws-small">
          <span className="ws-rel ws-rel-consistent"><span aria-hidden="true">✓</span> Customer confirmed this record</span> when asked{" "}
          <RefChip refId={confirmation.statementRef} />.
        </p>
      )}
      {facts.uninterpretedRefs.length > 0 && (
        <p className="ws-small ws-warn-text">
          Not yet interpreted: {facts.uninterpretedRefs.map((r) => <RefChip key={r} refId={r} />)} — facts from these statements are missing above.
        </p>
      )}
    </section>
  );
}
