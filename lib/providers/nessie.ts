/**
 * Capital One Nessie client (mock banking API).
 * Docs: https://nessieisreal.com/docs  Spec: https://nessieisreal.com/nessie-openapi-spec.yaml
 *
 * READ-ONLY for the investigator. The one write is `createDeposit`, used only by the approved
 * SIMULATED reimbursement payout (convex/payout.ts) through `depositOnce`. Seed-script writes live
 * in scripts/seed-nessie.ts.
 *
 * Verified notes (see docs/integrations.md):
 *  - Base URL https://api.nessieisreal.com, auth via `?key=` query parameter.
 *  - GET /accounts/{id}/purchases exists live but is not in the OpenAPI spec; live records
 *    carry `purchase_date` (docs show `transaction_date`) — both are accepted here.
 *  - Amounts may be stored as integers.
 *  - Nessie data is visible across API users: synthetic data only.
 */
import { z } from "zod";
import type { TransactionEvidence } from "../domain/schemas";
import { ProviderError, redact, type FetchLike } from "./errors";

export const NESSIE_DEFAULT_BASE_URL = "https://api.nessieisreal.com";

const dateish = z.string().nullish();
export const NessiePurchase = z
  .object({
    _id: z.string().min(1),
    merchant_id: z.string().nullish(),
    medium: z.string().nullish(),
    purchase_date: dateish,
    transaction_date: dateish,
    amount: z.number().finite(),
    status: z.string().nullish(),
    description: z.string().nullish(),
    type: z.string().nullish(),
    payer_id: z.string().nullish(),
  })
  .loose();
export type NessiePurchase = z.infer<typeof NessiePurchase>;

export const NessieMerchant = z
  .object({ _id: z.string().min(1), name: z.string().nullish(), category: z.union([z.string(), z.array(z.string())]).nullish() })
  .loose();
export type NessieMerchant = z.infer<typeof NessieMerchant>;

export const NessieAccount = z
  .object({ _id: z.string().min(1), type: z.string().nullish(), nickname: z.string().nullish(), customer_id: z.string().nullish(), balance: z.number().nullish() })
  .loose();
export type NessieAccount = z.infer<typeof NessieAccount>;

/** Deposit as listed by GET /accounts/{id}/deposits (spec schema `Deposit`; live shape unverified). */
export const NessieDeposit = z
  .object({ _id: z.string().min(1), amount: z.number().finite(), description: z.string().nullish(), transaction_date: dateish, status: z.string().nullish(), medium: z.string().nullish() })
  .loose();
export type NessieDeposit = z.infer<typeof NessieDeposit>;

/** Body of POST /accounts/{id}/deposits (spec schema `DepositCreate`; all fields required, amount is an integer). */
export interface DepositCreate {
  medium: "balance";
  transaction_date: string;
  status: "completed";
  amount: number;
  description: string;
}

/** Creation responses carry the new id in `objectCreated._id` (seen live for other POSTs) or `_id`. */
const CreatedResponse = z.object({ objectCreated: z.object({ _id: z.string().min(1) }).loose().optional(), _id: z.string().min(1).optional() }).loose();

export interface BankingProvider {
  getAccount(accountId: string): Promise<NessieAccount>;
  listPurchases(accountId: string): Promise<NessiePurchase[]>;
  getMerchant(merchantId: string): Promise<NessieMerchant>;
}

const ID = /^[A-Za-z0-9-]{8,64}$/;

export class NessieClient implements BankingProvider {
  constructor(
    private readonly apiKey: string,
    private readonly baseUrl: string = NESSIE_DEFAULT_BASE_URL,
    private readonly fetchImpl: FetchLike = fetch,
  ) {
    if (!apiKey) throw new ProviderError("nessie", "not_configured", "NESSIE_API_KEY is not set");
  }

  private async get<T>(path: string, schema: z.ZodType<T>): Promise<T> {
    return this.request("GET", path, schema);
  }

  private async request<T>(method: "GET" | "POST", path: string, schema: z.ZodType<T>, body?: unknown): Promise<T> {
    const url = `${this.baseUrl.replace(/\/$/, "")}${path}${path.includes("?") ? "&" : "?"}key=${encodeURIComponent(this.apiKey)}`;
    let res: Response;
    try {
      res = await this.fetchImpl(url, {
        method,
        headers: { Accept: "application/json", ...(body ? { "Content-Type": "application/json" } : {}) },
        ...(body ? { body: JSON.stringify(body) } : {}),
        signal: AbortSignal.timeout(15_000),
      });
    } catch (e) {
      throw new ProviderError("nessie", "network", this.scrub(String(e)));
    }
    const text = await res.text();
    if (!res.ok) {
      throw new ProviderError("nessie", "http", `HTTP ${res.status} for ${path}: ${this.scrub(text).slice(0, 200)}`, res.status);
    }
    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch {
      throw new ProviderError("nessie", "malformed_response", `non-JSON response for ${path}`);
    }
    const parsed = schema.safeParse(json);
    if (!parsed.success) {
      throw new ProviderError("nessie", "malformed_response", `${path}: ${parsed.error.issues.slice(0, 3).map((i) => `${i.path.join(".")} ${i.message}`).join("; ")}`);
    }
    return parsed.data;
  }

  /** Removes the API key from any text (provider error bodies can echo the request URL). */
  private scrub(text: string): string {
    return redact(text).split(this.apiKey).join("[REDACTED]");
  }

  private checkId(id: string) {
    if (!ID.test(id)) throw new ProviderError("nessie", "rejected_output", "invalid identifier format");
  }

  async getAccount(accountId: string) {
    this.checkId(accountId);
    return this.get(`/accounts/${accountId}`, NessieAccount);
  }
  async listPurchases(accountId: string) {
    this.checkId(accountId);
    return this.get(`/accounts/${accountId}/purchases`, z.array(NessiePurchase));
  }
  async getMerchant(merchantId: string) {
    this.checkId(merchantId);
    return this.get(`/merchants/${merchantId}`, NessieMerchant);
  }
  async listDeposits(accountId: string) {
    this.checkId(accountId);
    return this.get(`/accounts/${accountId}/deposits`, z.array(NessieDeposit));
  }
  /** The only write. Returns the new deposit's id. */
  async createDeposit(accountId: string, body: DepositCreate): Promise<string> {
    this.checkId(accountId);
    if (!Number.isInteger(body.amount) || body.amount <= 0) throw new ProviderError("nessie", "rejected_output", "Nessie deposits take a positive whole-dollar amount");
    const created = await this.request("POST", `/accounts/${accountId}/deposits`, CreatedResponse, body);
    const id = created.objectCreated?._id ?? created._id;
    if (!id) throw new ProviderError("nessie", "malformed_response", "deposit created but no id returned");
    return id;
  }
}

/**
 * Deposits at most once per marker. Before writing, it looks for an existing deposit whose
 * description carries the marker, so a retry after a lost response can't pay twice.
 */
export async function depositOnce(
  client: Pick<NessieClient, "listDeposits" | "createDeposit">,
  accountId: string,
  deposit: { amount: number; date: string; description: string; marker: string },
): Promise<{ depositId: string; reused: boolean }> {
  if (!deposit.description.includes(deposit.marker)) throw new ProviderError("nessie", "rejected_output", "deposit description must carry its idempotency marker");
  const existing = (await client.listDeposits(accountId)).find((d) => d.description?.includes(deposit.marker));
  if (existing) return { depositId: existing._id, reused: true };
  const depositId = await client.createDeposit(accountId, { medium: "balance", transaction_date: deposit.date, status: "completed", amount: deposit.amount, description: deposit.description });
  return { depositId, reused: false };
}

function normalizeDate(s: string | null | undefined): string | null {
  if (!s) return null;
  const m = s.match(/^(\d{4}-\d{2}-\d{2})/);
  return m ? m[1]! : null;
}

export function normalizePurchase(p: NessiePurchase, merchant: NessieMerchant | null): TransactionEvidence {
  return {
    ref: `T:${p._id}`,
    provider: "nessie",
    externalId: p._id,
    kind: "purchase",
    amount: p.amount,
    date: normalizeDate(p.purchase_date ?? p.transaction_date),
    description: p.description ?? null,
    merchantId: p.merchant_id ?? null,
    merchantName: merchant?.name ?? null,
    status: p.status ?? null,
    medium: p.medium ?? null,
  };
}

/** Deposits are credits to the account (refunds, our SIMULATED payouts); never matched as disputed payments. */
export function normalizeDeposit(d: NessieDeposit): TransactionEvidence {
  return {
    ref: `T:${d._id}`,
    provider: "nessie",
    externalId: d._id,
    kind: "deposit",
    amount: d.amount,
    date: normalizeDate(d.transaction_date),
    description: d.description ?? null,
    merchantId: null,
    merchantName: null,
    status: d.status ?? null,
    medium: d.medium ?? null,
  };
}

/** Retrieve purchases (with merchants) and deposits for one account. Lookup failures are reported, not hidden. */
export async function retrieveAccountTransactions(
  client: BankingProvider & Partial<Pick<NessieClient, "listDeposits">>,
  accountId: string,
  maxMerchants = 25,
): Promise<{ transactions: TransactionEvidence[]; warnings: string[] }> {
  await client.getAccount(accountId);
  const purchases = await client.listPurchases(accountId);
  const ids = [...new Set(purchases.map((p) => p.merchant_id).filter((x): x is string => !!x))].slice(0, maxMerchants);
  const merchants = new Map<string, NessieMerchant>();
  const warnings: string[] = [];
  for (const id of ids) {
    try {
      merchants.set(id, await client.getMerchant(id));
    } catch (e) {
      warnings.push(`merchant ${id} lookup failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  // Deposits show refunds already received. Their read shape is unverified (the demo account had none on 2026-10-24).
  let deposits: TransactionEvidence[] = [];
  if (client.listDeposits) {
    try {
      deposits = (await client.listDeposits(accountId)).map(normalizeDeposit);
    } catch (e) {
      warnings.push(`deposit lookup failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  return {
    transactions: [...purchases.map((p) => normalizePurchase(p, p.merchant_id ? merchants.get(p.merchant_id) ?? null : null)), ...deposits],
    warnings,
  };
}
