# Data provenance: what is raw provider data and what is ours

Everything in this prototype is synthetic. This note records, for each kind of data a reviewer
sees, where it came from and what we changed. Keep it current when a source or transformation
changes.

## Bank records (Capital One Nessie)

**Returned by the Nessie API, lightly normalized.** Each purchase is fetched live with
`GET /accounts/{id}/purchases`, plus `GET /merchants/{id}` for the payee name
(`lib/providers/nessie.ts`, `normalizePurchase`).

| Field | Source | What we change |
|---|---|---|
| amount, status, medium, description, merchant ID | Nessie purchase record | Nothing |
| date | `purchase_date` (or `transaction_date`) | Truncated to `YYYY-MM-DD` |
| payee name | Nessie merchant record | Nothing; looked up by `merchant_id` |
| ref | Nessie `_id` | Prefixed: `T:<_id>` |
| kind | not from Nessie | Always `purchase` (we only read purchases) |

**But the records themselves are ours.** Nessie is a mock API that stores whatever is posted to
it. The demo customer, account, merchants (`FCI Demo …`) and the 5 purchases were created by
`scripts/seed-nessie.ts` from `lib/fixtures/demo.ts`. So Nessie returns our synthetic data
unchanged, not real Capital One data.

Records are never edited after retrieval. If a re-retrieval returns different values, the old
row is kept as superseded history.

## Customer statements

**Not from Capital One. Customer-reported, synthetic.**

- **Voice calls:** the Cartesia agent's `record_statement` tool sends the customer's words.
  Card numbers, codes, passwords and SSNs are removed before storage (`lib/domain/redact.ts`);
  only the kind of value removed is kept.
- **Developer console:** typed by hand, or picked from the demo script in `lib/fixtures/demo.ts`.
- **Seeded demo cases on the personal review deployment** (`friendly-grouse-183`, 2026-10-24):
  written by the developer agent with a one-off script that is not in the repo. Sources:
  - from `DEMO_STATEMENTS` in `lib/fixtures/demo.ts`: the $389 Volt Electronics statement,
    "There's a $49 charge I don't recognize" and "Actually, it was the gift card one…";
  - from `tests/workflow.test.ts`: the two contradictory $389 statements;
  - written for testing: the long Corner Grocer statement and the "pretending to be the bank"
    $389 statement.

  The shared deployment has none of these seeded cases.

## Derived by the app (rule-based, not provider data)

- Statement interpretations (amounts, dates, payee terms, position): scripted extractor, labelled.
- Matching, conflicts, findings, open questions, draft recommendation and packet:
  `lib/domain/workflow.ts` and `lib/domain/matching.ts`.
- Reviewer triage and next steps: `lib/domain/triage.ts`.

## Identity evidence (CRS sandbox)

Values are returned by the CRS sandbox for CRS-published test personas, unchanged. Linking a
persona to a case is a **synthetic association** we create; CRS and Nessie are separate datasets.

## Display-only changes in the claims workstation (`/review`)

These change how data looks, never what is stored:

- Case references (`FC-XXXXXX`) are the last 6 characters of the Convex case ID.
- Long Nessie IDs are shortened in chips and tables (`T:3dab…3d67`); the full ID is in the
  tooltip and accessible label.
- Amounts are formatted as US dollars; times are shown in the viewer's time zone.
- Customer positions are relabelled in plain language (for example `denies_authorization` →
  "Says they did not make the payment").
