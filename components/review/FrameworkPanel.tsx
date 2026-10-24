"use client";

/** The applicable framework: sources the model read, sources the guardrail flagged, the policy result, reference rules consulted. */
import { ShieldCheck, ShieldOff } from "lucide-react";
import { getSource } from "@/lib/domain/regulatory";
import { frameworkSources, policySummary, registryRuleText } from "@/lib/review/inspector";
import { READING_LABEL, policyLabel } from "@/lib/review/labels";
import { Pill, Row, type Tone } from "./ui";
import { useWorkspace } from "./WorkspaceContext";

const READING_TONE: Record<string, Tone> = { likely_applies: "ok", likely_does_not_apply: "quiet", unclear: "warn" };

export function FrameworkPanel() {
  const { ws, select, isSelected } = useWorkspace();
  const { analysis, proposal, auto } = ws;
  const sources = frameworkSources(analysis, proposal);
  const policy = policySummary(auto);
  const consulted = proposal?.investigation.rulesConsulted ?? [];
  const nothing = sources.length === 0 && !policy && consulted.length === 0;
  return (
    <section className="card" aria-labelledby="framework-h">
      <div className="card-head">
        <h2 id="framework-h">Rules and policy</h2>
      </div>
      {nothing ? (
        <p className="muted">Not assessed yet.</p>
      ) : (
        <ul className="rows">
          {sources.map((s) => {
            const src = getSource(s.ref);
            const sel = { kind: "rule" as const, ref: s.ref };
            return (
              <Row key={s.ref} selected={isSelected(sel)} onSelect={() => select(sel)} lead={s.reading ? <Pill tone={READING_TONE[s.reading.reading] ?? "neutral"}>{READING_LABEL[s.reading.reading]}</Pill> : <Pill tone="quiet">Flagged by rules</Pill>}>
                <span>
                  <strong>{src?.citation ?? s.ref}</strong>
                  {src && <span className="muted"> · {src.title}</span>}
                </span>
                <span className="row-note">{s.reading?.note ?? s.relevance ?? ""}</span>
              </Row>
            );
          })}
          {policy && (
            <Row
              selected={isSelected({ kind: "policy" })}
              onSelect={() => select({ kind: "policy" })}
              lead={
                policy.eligible ? (
                  <Pill tone="ok">
                    <ShieldCheck size={12} aria-hidden="true" /> Eligible
                  </Pill>
                ) : (
                  <Pill tone="quiet">
                    <ShieldOff size={12} aria-hidden="true" /> Not eligible
                  </Pill>
                )
              }
            >
              <span>
                <strong>{policyLabel(policy.policy).name}</strong>
                {policyLabel(policy.policy).version && <span className="muted"> · v{policyLabel(policy.policy).version}</span>}
              </span>
              <span className="row-note">
                {policy.passed} of {policy.total} checks pass
              </span>
            </Row>
          )}
          {consulted.map((r) => {
            const rule = registryRuleText(r.ruleId);
            const sel = { kind: "registry" as const, id: r.ruleId };
            return (
              <Row key={r.ruleId} selected={isSelected(sel)} onSelect={() => select(sel)} lead={<Pill tone="quiet">Reference</Pill>}>
                <span>
                  <strong>{r.ruleId}</strong>
                  {rule && <span className="muted"> · {rule.rule}</span>}
                </span>
                <span className="row-note">{r.why}</span>
              </Row>
            );
          })}
        </ul>
      )}
    </section>
  );
}
