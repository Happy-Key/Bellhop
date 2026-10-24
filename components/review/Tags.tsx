/**
 * Who-acts markers. Customer and bank items always carry a distinct shape AND a text label, so
 * the distinction never depends on color.
 */
import type { Attention } from "@/lib/domain/triage";

export function AudienceTag({ audience }: { audience: "customer" | "reviewer" }) {
  return (
    <span className={`ws-aud ws-aud-${audience}`}>
      <span className="ws-aud-shape" aria-hidden="true" />
      {audience === "customer" ? "Customer" : "Bank"}
    </span>
  );
}

export function AttentionGlyph({ attention }: { attention: Attention }) {
  return <span className={`ws-glyph ws-glyph-${attention}`} aria-hidden="true" />;
}

export type EvidenceKind = "reported" | "observed" | "inferred" | "recommended";

const KIND_LABEL: Record<EvidenceKind, string> = {
  reported: "Reported",
  observed: "Observed",
  inferred: "Inferred",
  recommended: "Recommended",
};

const KIND_TITLE: Record<EvidenceKind, string> = {
  reported: "What the customer said (unverified)",
  observed: "What a record shows",
  inferred: "What the rules currently read from the evidence",
  recommended: "What the system proposes; a person decides",
};

/** Reported / observed / inferred / recommended. A distinct shape and a text label, never color alone. */
export function KindTag({ kind }: { kind: EvidenceKind }) {
  return (
    <span className={`ws-kind ws-kind-${kind}`} title={KIND_TITLE[kind]}>
      <span className="ws-kind-shape" aria-hidden="true" />
      {KIND_LABEL[kind]}
    </span>
  );
}
