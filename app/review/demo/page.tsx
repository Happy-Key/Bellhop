import type { Metadata } from "next";
import { DemoWorkspace } from "@/components/review/DemoWorkspace";

export const metadata: Metadata = {
  title: "Guided intake demo (synthetic) · Claims workstation",
  description: "Scripted synthetic scenario showing adaptive intake questions, evidence and draft routes. Nothing is saved.",
};

export default function GuidedIntakeDemoPage() {
  return <DemoWorkspace />;
}
