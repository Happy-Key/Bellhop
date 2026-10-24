import { describe, expect, it } from "vitest";
import { crsLogin, identityEvidence, tokenExpiry, verifyIdentity } from "@/lib/providers/crs";
import { getCrsPersona, type CrsPersona } from "@/lib/fixtures/crsPersonas";
import { analyzeCase } from "@/lib/domain/workflow";
import type { FetchLike } from "@/lib/providers/errors";
import { LEDGER, NOW, resetStatements, stmt } from "./helpers/build";

const BASE = "https://crs.example.invalid/api";
const P01 = getCrsPersona("P01")!;
const P12 = getCrsPersona("P12")!;
const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...headers } });

describe("CRS client (mocked)", () => {
  it("logs in and computes token expiry", async () => {
    const t = await crsLogin(BASE, "u", "p", async () => json(200, { token: "jwt", expires: "2026-10-24T00:00:00Z" }), NOW);
    expect(t).toEqual({ token: "jwt", expiresAt: Date.parse("2026-10-24T00:00:00Z") });
    expect(tokenExpiry(undefined, NOW)).toBe(NOW + 30 * 60 * 1000);
    expect(tokenExpiry(3600, NOW)).toBe(NOW + 3_600_000);
  });

  it("surfaces login failures without leaking the password", async () => {
    const err = await crsLogin(BASE, "u", "s3cret!", async () => json(401, { codes: ["CRS113"], messages: ["Access Denied for s3cret!"] })).catch((e: unknown) => e);
    expect(err).toMatchObject({ kind: "http", httpStatus: 401 });
    expect((err as Error).message).toContain("CRS113");
    expect((err as Error).message).not.toContain("s3cret!");
  });

  it("requires credentials", async () => {
    await expect(crsLogin(BASE, "", "", async () => json(200, {}))).rejects.toMatchObject({ kind: "not_configured" });
  });

  it("sends exactly the persona body and parses verified / failed results", async () => {
    let sent: unknown;
    const pass: FetchLike = async (_u, init) => {
      sent = JSON.parse(String(init?.body));
      return json(200, { addOnProducts: [{ idManagerVerification: { messages: [] } }] }, { RequestID: "req-1" });
    };
    const r = await verifyIdentity(BASE, "jwt", P01, pass);
    expect(sent).toEqual(P01.identityBody);
    expect(r).toEqual({ personaId: "P01", requestId: "req-1", messages: [] });

    const fail = await verifyIdentity(BASE, "jwt", P12, async () =>
      json(200, { addOnProducts: [{ idManagerVerification: { messages: [{ code: 2201, text: "SSN issued to a different name" }] } }] }));
    expect(fail.messages).toEqual([{ code: "2201", text: "SSN issued to a different name" }]);
  });

  it("refuses to send non-persona identities (billing guard)", async () => {
    const real: CrsPersona = { ...P01, identityBody: { ...P01.identityBody, ssn: "123456789" } };
    await expect(verifyIdentity(BASE, "jwt", real, async () => json(200, {}))).rejects.toMatchObject({ kind: "rejected_output" });
  });

  it("rejects malformed responses and reports structured errors", async () => {
    await expect(verifyIdentity(BASE, "jwt", P01, async () => json(200, { unexpected: true }))).rejects.toMatchObject({ kind: "malformed_response" });
    const e = await verifyIdentity(BASE, "jwt", P01, async () => json(401, { codes: ["CRS111"], messages: ["Unauthorized"] })).catch((x: unknown) => x);
    expect(e).toMatchObject({ kind: "http", httpStatus: 401 });
    expect((e as Error).message).toContain("CRS111");
  });
});

describe("CRS evidence in the workflow", () => {
  it("records provider facts with synthetic association and does not change the recommendation", () => {
    resetStatements();
    const statements = [stmt("I did not make the $389 purchase at Volt Electronics. I never shared my card or codes.")];
    const bankFetch = { status: "ok", at: NOW, count: LEDGER.length } as const;
    const without = analyzeCase({ statements, transactions: LEDGER, providerEvidence: [], bankFetch });
    const evidence = identityEvidence({ personaId: "P12", requestId: "r1", messages: [{ code: "2201", text: "SSN issued to a different name" }] }, "r1");
    const withCrs = analyzeCase({ statements, transactions: LEDGER, providerEvidence: evidence, bankFetch });

    expect(evidence.every((e) => e.syntheticAssociation)).toBe(true);
    const f = withCrs.findings.find((x) => x.category === "external_provider");
    expect(f?.evidenceRefs).toEqual(["X:crs:P12:r1:result", "X:crs:P12:r1:msg1"]);
    expect(f?.text).toContain("SYNTHETIC association");
    const q = withCrs.questions.find((x) => x.kind === "identity_review");
    expect(q?.blocking).toBe(false);
    expect(q?.text).toContain("not evidence that the claim is false");
    expect(withCrs.recommendation).toEqual(without.recommendation);
  });
});
