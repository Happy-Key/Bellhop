"use client";

import { ConvexProvider, ConvexReactClient } from "convex/react";
import { useMemo, type ReactNode } from "react";

export function ConvexClientProvider({ children }: { children: ReactNode }) {
  const url = process.env.NEXT_PUBLIC_CONVEX_URL;
  const client = useMemo(() => (url ? new ConvexReactClient(url) : null), [url]);
  if (!client) {
    return (
      <p className="error">
        NEXT_PUBLIC_CONVEX_URL is not set. Run <code>npx convex dev</code> (see README) to configure a deployment.
      </p>
    );
  }
  return <ConvexProvider client={client}>{children}</ConvexProvider>;
}
