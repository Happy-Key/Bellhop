import type { Metadata } from "next";
import { PitchDemo } from "@/components/review/PitchDemo";

export const metadata: Metadata = {
  title: "Demo (synthetic) · Claims workstation",
  description: "Scripted replay: a customer's account of a payment becomes an evidence-backed proposed outcome that a person authorizes. Nothing is saved.",
};

export default function DemoPage() {
  return <PitchDemo />;
}
