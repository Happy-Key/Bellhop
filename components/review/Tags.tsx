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
