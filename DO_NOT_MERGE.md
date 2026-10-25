# DO NOT MERGE THIS BRANCH

`experiment/claim-suite-do-not-merge` is a parked experiment, kept for reference only.

- It branched from `foundation` at `5097cd3`, **before** the Bellhop frontend overhaul. Merging it
  would undo or conflict with that work (it rewrites `/review`, `/call` and the schema differently).
- Its ideas are to be **ported by hand** onto `foundation` when wanted, following
  `docs/claim-suite-experiment.md` (findings, file map, porting checklist).
- Already ported to `foundation` (2026-10-24): `REASONING_EFFORT` and lenient investigation parsing.

What it holds: the 17-persona claim suite with answer sheets and a Bitdeer-simulated customer,
the `/review/suite` runner, `npm run reset:convex` (restores the Nessie seeds), the AUTO-1 v3
double-payment guard, `nextQuestionFor`, and several conversation bug fixes.
