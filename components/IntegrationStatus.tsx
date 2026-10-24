"use client";

import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";

const yes = (b: boolean) => (b ? "set" : "missing");

export function IntegrationStatus() {
  const s = useQuery(api.system.integrationStatus);
  if (!s) return null;
  return (
    <section>
      <h2>Integration status</h2>
      <table>
        <tbody>
          <tr>
            <td>Nessie (bank records)</td>
            <td>
              <span className={`label ${s.nessie.status === "configured" ? "live" : "error"}`}>{s.nessie.status}</span>
              API key {yes(s.nessie.apiKey)}, demo account {yes(s.nessie.demoAccount)}. Retrieval is always a LIVE call.
            </td>
          </tr>
          <tr>
            <td>Reasoning</td>
            <td>
              <span className={`label ${s.reasoning.mode === "live" ? "live" : "scripted"}`}>{s.reasoning.mode}</span>
              {s.reasoning.label}
              {s.reasoning.mode === "scripted" && " — deterministic patterns, NOT a model."}
              {!s.reasoning.complete && <span className="error"> Live provider selected but not fully configured.</span>}
            </td>
          </tr>
          <tr>
            <td>Cartesia (voice)</td>
            <td>
              <span className="label notimpl">partial</span>
              API key {yes(s.cartesia.apiKey)}, agent id {yes(s.cartesia.agentId)}, tool secret {yes(s.cartesia.toolSecret)}. {s.cartesia.status}.
            </td>
          </tr>
          <tr>
            <td>CRS (identity evidence)</td>
            <td>
              <span className={`label ${s.crs.status === "configured" ? "live" : "error"}`}>{s.crs.status}</span>
              Credentials {yes(s.crs.credentials)}. TransUnion basic identity check on published test personas only.
            </td>
          </tr>
          <tr><td>Simulated reimbursement</td><td><span className="label notimpl">not implemented</span></td></tr>
        </tbody>
      </table>
    </section>
  );
}
