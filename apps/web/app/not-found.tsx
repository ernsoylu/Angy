import { Button } from "../components/ui/Button";
import { EmptyState } from "../components/ui/SystemState";

export default function NotFound() {
  return (
    <main style={{ minHeight: "100dvh", display: "grid", placeItems: "center" }}>
      <div>
        <EmptyState
          title="This page doesn't exist"
          body="It may have been moved to another space, renamed, or hard-deleted from the trash."
          action={<Button href="/">Back to your workspace</Button>}
        />
      </div>
    </main>
  );
}
