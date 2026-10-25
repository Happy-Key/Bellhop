"use client";

import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";

const yes = (b: boolean) => (b ? "set" : "missing");

/** What the backend reports about its configuration. Only whether settings exist, never their values. */
export function IntegrationStatus() {
  const s = useQuery(api.system.integrationStatus);
  if (!s) return null;
  return (
    <section className="dev-section">
      <h2>Integrations</h2>
      <table>
        <tbody>
          <tr>
            <td>Nessie (bank records)</td>
            <td>
              <span className={`label ${s.nessie.status === "configured" ? "live" : "error"}`}>{s.nessie.status}</span>
              API key {yes(s.nessie.apiKey)}, demo account {yes(s.nessie.demoAccount)}. Retrieval is always a live call.
            </td>
          </tr>
          <tr>
            <td>Reasoning</td>
            <td>
              <span className={`label ${s.reasoning.mode === "live" ? "live" : "scripted"}`}>{s.reasoning.mode}</span>
              {s.reasoning.label}
              {s.reasoning.mode === "scripted" && " (deterministic patterns, not a model)"}
              {!s.reasoning.complete && <span className="error"> Live provider selected but not fully configured.</span>}
            </td>
          </tr>
          <tr>
            <td>Cartesia (voice)</td>
            <td>
              <span className={`label ${s.cartesia.status === "configured" ? "live" : "error"}`}>{s.cartesia.status.replace(/_/g, " ")}</span>
              API key {yes(s.cartesia.apiKey)}, agent id {yes(s.cartesia.agentId)}, tool secret {yes(s.cartesia.toolSecret)}. Managed Agent voice calls from the browser
              (short-lived agent tokens), with the webhook tool recording each turn.
            </td>
          </tr>
          <tr>
            <td>CRS (identity evidence)</td>
            <td>
              <span className={`label ${s.crs.status === "configured" ? "live" : "error"}`}>{s.crs.status}</span>
              Credentials {yes(s.crs.credentials)}. TransUnion basic identity check on published test personas only.
            </td>
          </tr>
          <tr>
            <td>Simulated reimbursement</td>
            <td>
              <span className="label synthetic">simulated</span>
              {s.payout.status}
            </td>
          </tr>
        </tbody>
      </table>
    </section>
  );
}
