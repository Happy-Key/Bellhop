"use client";

/**
 * Customer view: only the voice call. Each visit opens one synthetic case, created when the first
 * call starts and reused for "Call again", so the bank sees the whole conversation on one case.
 * Nothing here reads case data; the bank dashboard is at "/".
 */
import { useRef } from "react";
import { useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { VoiceCall } from "@/components/VoiceCall";

export default function CustomerCallPage() {
  const create = useMutation(api.cases.createSynthetic);
  const caseId = useRef<Promise<Id<"cases">> | null>(null);

  const resolveCase = () => {
    caseId.current ??= create({}).catch((e: unknown) => {
      caseId.current = null; // let the next attempt retry
      throw e;
    });
    return caseId.current;
  };

  return (
    <main style={{ maxWidth: 640, margin: "0 auto" }}>
      <h1 style={{ textAlign: "center" }}>Report a suspicious transaction</h1>
      <p className="muted" style={{ textAlign: "center" }}>
        Talk to our assistant about a payment you don&apos;t recognize. It will ask a few questions and pass your report to our
        fraud team for review. It cannot move money or approve refunds.
      </p>
      <VoiceCall caseId={resolveCase} variant="customer" />
    </main>
  );
}
