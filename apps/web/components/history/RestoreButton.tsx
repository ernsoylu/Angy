"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { History } from "lucide-react";
import { Button } from "../ui/Button";
import { useToast } from "../ui/ToastProvider";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

export function RestoreButton({ pageId, version }: { pageId: string; version: number }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const { toast } = useToast();

  async function restore() {
    setBusy(true);
    try {
      const res = await fetch(`${API_URL}/pages/${pageId}/revisions/${version}/restore`, {
        method: "POST",
        credentials: "include",
      });
      const body = await res.json();
      if (!body.success) throw new Error(body.error.message);
      toast("success", `Restoring v${version}`, "Re-applied as a new forward version.");
      // The restore applies live; the labelled checkpoint lands ~6s later.
      await new Promise((r) => setTimeout(r, 7000));
      router.push(window.location.pathname);
      router.refresh();
    } catch (err) {
      toast("error", "Restore failed", (err as Error).message);
      setBusy(false);
    }
  }

  return (
    <Button icon={<History size={14} />} disabled={busy} onClick={restore}>
      {busy ? "Restoring…" : `Restore v${version}`}
    </Button>
  );
}
