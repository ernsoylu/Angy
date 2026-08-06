"use client";

import { ErrorState } from "../components/ui/SystemState";

export default function GlobalError({ reset }: { error: Error; reset: () => void }) {
  return (
    <main style={{ minHeight: "100dvh", display: "grid", placeItems: "center" }}>
      <ErrorState
        title="Something went wrong"
        body="Retry, or head back — if this keeps happening, the service may be down."
        actionLabel="Retry"
        onAction={reset}
      />
    </main>
  );
}
