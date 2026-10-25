# CalHacks: Fraud Claims Investigator (prototype)

A web-based investigator for suspected-fraud claims on U.S. consumer bank accounts. It records
the customer's account of events, matches it against bank records retrieved from Capital One
Nessie, identifies missing or conflicting facts and asks follow-up questions, and prepares an
evidence-linked **draft** claim packet for human review, with potentially relevant
regulatory considerations.

> **All customer data is synthetic.** The app only *recommends*: it never moves money,
> approves reimbursements, or files complaints.

See `docs/status.md` for what is done, `docs/architecture.md` for the design, and
`docs/integrations.md` for verified provider facts.

## Requirements

- **Node.js 24 LTS** (`.nvmrc`). Windows and macOS are both supported; no WSL needed.
- npm (the committed `package-lock.json` is the only lockfile; don't use yarn or pnpm).

## Setup

```bash
npm install
npx convex dev          # first run: log in and create a dev deployment (writes .env.local)
```

To develop with no Convex account, use a local anonymous backend:

```bash
# macOS/Linux
CONVEX_AGENT_MODE=anonymous npx convex dev
# Windows PowerShell
$env:CONVEX_AGENT_MODE="anonymous"; npx convex dev
```

Voice testing needs a **cloud** dev deployment, because Cartesia must reach a public HTTPS URL.

## Run

Use two terminals:

```bash
npx convex dev      # backend (keeps running, pushes function changes)
npm run dev         # web app at http://localhost:3000
```

Or run both at once with `npm run dev:all`.

## Configuration

Copy names from `.env.example`. Never commit `.env.local` and never paste keys into chat.

| Where | Variables |
|---|---|
| `.env.local` (auto) | `CONVEX_DEPLOYMENT`, `NEXT_PUBLIC_CONVEX_URL`, `NEXT_PUBLIC_CONVEX_SITE_URL` |
| **Convex env** (`npx convex env set NAME value`) | `NESSIE_API_KEY`, `NESSIE_DEMO_ACCOUNT_ID`, `REASONING_*`, `CARTESIA_API_KEY`, `CARTESIA_AGENT_ID`, `VOICE_TOOL_SECRET`, later `CRS_*` |
| `.env.local` (scripts only) | `NESSIE_API_KEY`, `NESSIE_DEMO_ACCOUNT_ID` for `seed:nessie` / `live:nessie` |

Convex functions read **only** the Convex deployment environment.

### Nessie demo account

1. Get a key at https://nessieisreal.com (GitHub login) and put `NESSIE_API_KEY=…` in `.env.local`.
2. Run `npm run seed:nessie -- --confirm`. This creates synthetic records in the **shared**
   sandbox and prints an account ID.
3. Run `npx convex env set NESSIE_API_KEY <key>` and `npx convex env set NESSIE_DEMO_ACCOUNT_ID <id>`.
4. Run `npm run live:nessie` to check the live read path.

## Verify

```bash
npm run verify       # typecheck + lint + unit tests (mocked) + production build
npm test             # unit tests only
npm run live:nessie  # explicit LIVE check (uses your key; not part of verify)
```

## Demo flow

1. Create a synthetic claim and record "There's a $49 charge I don't recognize."
2. Click **Retrieve bank records**. The two $49 purchases make the match **ambiguous**, so
   the app asks which one.
3. Answer "Actually, it was the gift card one, at GiftCard Hub." This is recorded as a
   correction of S1. The original statement is kept, and the match is now clear.
4. Review the findings, open questions, considerations and recommendation. Badges show what
   is scripted, what is live, and what is synthetic.
