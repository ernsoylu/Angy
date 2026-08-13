"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { FileStack, FolderInput, Trash2 } from "lucide-react";
import { Button } from "../ui/Button";
import { MoveDialog } from "./MoveDialog";
import { SaveTemplateDialog } from "./SaveTemplateDialog";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

export function PageActions({
  pageId,
  pageTitle,
  spaceKey,
}: {
  pageId: string;
  pageTitle: string;
  spaceKey: string;
}) {
  const router = useRouter();
  const [moveOpen, setMoveOpen] = useState(false);
  const [templateOpen, setTemplateOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  async function trash() {
    setBusy(true);
    try {
      const res = await fetch(`${API_URL}/pages/${pageId}/trash`, {
        method: "POST",
        credentials: "include",
      });
      const body = await res.json();
      if (body.success) {
        router.push(`/s/${spaceKey}`);
        router.refresh();
        return;
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Button
        variant="secondary"
        icon={<FolderInput size={14} />}
        onClick={() => setMoveOpen(true)}
      >
        Move page
      </Button>
      <Button
        variant="secondary"
        icon={<FileStack size={14} />}
        onClick={() => setTemplateOpen(true)}
      >
        Save as template
      </Button>
      <Button
        variant="danger"
        icon={<Trash2 size={14} />}
        disabled={busy}
        onClick={() => void trash()}
      >
        Move to trash
      </Button>
      {templateOpen && (
        <SaveTemplateDialog
          pageId={pageId}
          pageTitle={pageTitle}
          onClose={() => setTemplateOpen(false)}
        />
      )}
      {moveOpen && (
        <MoveDialog
          pageId={pageId}
          pageTitle={pageTitle}
          spaceKey={spaceKey}
          onClose={() => setMoveOpen(false)}
        />
      )}
    </>
  );
}
