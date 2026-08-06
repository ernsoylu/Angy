"use client";

import { ErrorState } from "../../../components/ui/SystemState";

/** Frame 11: no silent failure — data-surface errors render the design state. */
export default function SpaceError({ reset }: { error: Error; reset: () => void }) {
  return (
    <ErrorState
      title="Something went wrong loading this view"
      body="The rest of the app is fine. Retry, or navigate elsewhere — nothing you wrote is lost."
      actionLabel="Retry"
      onAction={reset}
    />
  );
}
