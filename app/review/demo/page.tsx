import type { Metadata } from "next";
import { DemoStory } from "@/components/demo/DemoStory";

export const metadata: Metadata = {
  title: "Bellhop · Demo",
  description: "One claim, from the customer's call to a person's decision. Scripted replay on synthetic data.",
};

export default function DemoPage() {
  return <DemoStory />;
}
