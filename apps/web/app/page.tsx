import { redirect } from "next/navigation";
import { getMe, getSpaces } from "../lib/api";
import { EmptyState } from "../components/ui/SystemState";
import { NewSpaceButton } from "../components/spaces/NewSpaceButton";

/**
 * Workspace entry point: drop into your first space, or — on a fresh
 * deployment — offer to create one.
 *
 * This used to `redirect("/signin")` when the list came back empty, which
 * conflated two unrelated conditions. A signed-in user with no spaces is not an
 * unauthenticated user, and bouncing them to the sign-in screen made a
 * *successful* login look like a failed one: you authenticate, land back on
 * sign-in, and try again forever. Only `apiFetch` may route to /signin, and
 * only on a 401.
 */
export default async function RootPage() {
  const [spaces, me] = await Promise.all([getSpaces(), getMe()]);
  if (spaces.length > 0) redirect(`/s/${spaces[0]!.key}`);

  return (
    <main style={{ minHeight: "100dvh", display: "grid", placeItems: "center", padding: 24 }}>
      <div style={{ width: "min(460px, 92vw)" }}>
        <EmptyState
          title="No spaces yet"
          body="A space holds a team's pages and sets who can read them. Create the first one to get started — you'll be its admin."
          action={<NewSpaceButton />}
        />
        {/* Naming the account here is the cheap fix for the confusion this
            screen used to cause: if you expected content and see an empty
            workspace, the first question is which identity you arrived as. */}
        <p
          style={{
            textAlign: "center",
            marginTop: -18,
            fontSize: 12.5,
            color: "var(--text-3)",
          }}
        >
          Signed in as {me.displayName || me.email}
        </p>
      </div>
    </main>
  );
}
