"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Star } from "lucide-react";
import { Button } from "../ui/Button";
import { useToast } from "../ui/ToastProvider";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

/** Star toggle in the page-info rail — feeds the sidebar's Starred list. */
export function StarButton({ pageId, initial }: { pageId: string; initial: boolean }) {
  const [starred, setStarred] = useState(initial);
  const [busy, setBusy] = useState(false);
  const router = useRouter();
  const { toast } = useToast();

  async function toggle() {
    const next = !starred;
    setBusy(true);
    // Optimistic: the control is a bookmark, not a destructive action.
    setStarred(next);
    try {
      const res = await fetch(`${API_URL}/pages/${pageId}/star`, {
        method: next ? "PUT" : "DELETE",
        credentials: "include",
      });
      const body = await res.json();
      if (!body.success) {
        setStarred(!next);
        toast("error", next ? "Could not star" : "Could not unstar", body.error.message);
        return;
      }
      router.refresh(); // the sidebar's Starred count comes from the server
    } catch {
      setStarred(!next);
      toast("error", "Network error", "Your star was not saved.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Button
      variant="secondary"
      disabled={busy}
      aria-pressed={starred}
      onClick={() => void toggle()}
      icon={
        <Star size={14} fill={starred ? "currentColor" : "none"} />
      }
      style={{ marginTop: 6 }}
    >
      {starred ? "Starred" : "Star page"}
    </Button>
  );
}
