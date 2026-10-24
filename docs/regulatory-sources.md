# Regulatory sources (curated)

Scope: **U.S. consumer deposit (asset) account claims**, one disputed transaction per case,
three scenarios:

1. The customer denies authorizing an electronic debit.
2. The customer initiated a payment after being deceived (a scam).
3. The customer mentions a wire.

The machine-readable list is in `lib/domain/regulatory.ts`. Only sources listed there can be
cited (refs `R:<id>`). A finding that cites any other `R:` reference is rejected.

| Ref | Kind | Citation | URL | Reviewed | Excerpt verified verbatim |
|---|---|---|---|---|---|
| R:reg-e.1005.2m | law (regulation) | 12 CFR 1005.2(m) | https://www.consumerfinance.gov/rules-policy/regulations/1005/2/ | 2026-10-23 | yes |
| R:reg-e.interp.2m-2 | official interpretation | Supp. I comment 2(m)-2 | https://www.consumerfinance.gov/rules-policy/regulations/1005/interp-2/#2-m-Interp | 2026-10-23 | yes |
| R:reg-e.interp.2m-3 | official interpretation | Supp. I comment 2(m)-3 | same | 2026-10-23 | yes |
| R:reg-e.1005.3c3 | law (regulation) | 12 CFR 1005.3(c)(3) | https://www.consumerfinance.gov/rules-policy/regulations/1005/3/ | 2026-10-23 | yes |
| R:reg-e.1005.6b | law (regulation) | 12 CFR 1005.6(b) | https://www.consumerfinance.gov/rules-policy/regulations/1005/6/ | 2026-10-23 | **no (paraphrase)** |
| R:reg-e.1005.11 | law (regulation) | 12 CFR 1005.11 | https://www.consumerfinance.gov/rules-policy/regulations/1005/11/ | 2026-10-23 | **no (paraphrase)** |
| R:cfpb.eft-faq.induced-sharing | agency guidance | CFPB EFT FAQs, Error Resolution: Unauthorized EFTs | https://www.consumerfinance.gov/compliance/compliance-resources/deposit-accounts-resources/electronic-fund-transfers/electronic-fund-transfers-faqs/ | 2026-10-23 | **no (from a summarizing fetch; verify the question numbers and wording)** |
| R:policy.demo-scam-review | institution policy | **SYNTHETIC** demo policy DP-1 | this file | 2026-10-23 | n/a |

## Applicability rules encoded

- Regulation E is **never presumed** to apply. Each consideration lists conditions as
  supported by a customer statement, supported by a record, contradicted, or unresolved.
- Whether a transaction is an EFT from a consumer asset account is always **unresolved** until
  the payment rail is confirmed. Nessie purchase records don't establish the rail.
- When a customer-initiated scam payment is reported, the 1005.2(m) condition "initiated by a
  person other than the consumer" is **contradicted** by the customer's own statement. The case
  is escalated under the institution policy and is **not** treated as automatically reimbursable.
- A mention of a wire surfaces the 1005.3(c)(3) exclusion as a condition to check. UCC
  Article 4A (state law) is noted but not curated.
- **No deadlines are calculated.** The 1005.6 and 1005.11 timing rules depend on notice dates,
  account age and transaction type, none of which the prototype verifies.

## Synthetic demo policy

DP-1 (synthetic, for this prototype only): payments the customer initiated after being
deceived are routed to a fraud specialist for review. Reimbursement is discretionary and never
automatic. This is not a real institution's policy.

## Before external use

- Re-verify the paraphrased excerpts word for word against the URLs.
- Have a compliance professional review the scenario scoping.
- Changes to this list require human review. The developer agent must never edit
  `lib/domain/regulatory.ts`.
