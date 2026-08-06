"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { FilePlus2, X } from "lucide-react";
import type { TreeNode } from "../../lib/tree";
import { Button } from "../ui/Button";
import { IconButton } from "../ui/IconButton";
import { Select } from "../ui/Select";
import share from "../share/share.module.css";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

export function NewPageDialog({
  spaceId,
  spaceKey,
  spaceName,
  tree,
  onClose,
}: {
  spaceId: string;
  spaceKey: string;
  spaceName: string;
  tree: TreeNode[];
  onClose: () => void;
}) {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [parentId, setParentId] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Flatten the tree for the parent picker, depth-indented.
  const options: { id: string; label: string }[] = [];
  const walk = (nodes: TreeNode[], depth: number) => {
    for (const node of nodes) {
      options.push({ id: node.id, label: `${"— ".repeat(depth)}${node.title}` });
      walk(node.children, depth + 1);
    }
  };
  walk(tree, 0);

  async function create() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`${API_URL}/pages`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          spaceId,
          title: title.trim(),
          parentId: parentId || null,
        }),
      });
      const body = await res.json();
      if (!body.success) throw new Error(body.error.message);
      router.push(`/s/${spaceKey}/${body.data.id}/edit`);
      router.refresh();
      onClose();
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  return (
    <div className={share.overlay} onClick={onClose}>
      <div
        className={share.dialog}
        role="dialog"
        aria-label="New page"
        onClick={(e) => e.stopPropagation()}
        style={{ width: 480 }}
      >
        <header className={share.header}>
          <h2 className={share.title}>New page</h2>
          <IconButton label="Close" onClick={onClose}>
            <X size={15} />
          </IconButton>
        </header>

        {error && <div className={share.error}>{error}</div>}

        <input
          className={share.inviteInput}
          placeholder="Page title..."
          value={title}
          autoFocus
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && title.trim()) void create();
          }}
        />
        <div className="t-caption">Location</div>
        <Select value={parentId} onChange={(e) => setParentId(e.target.value)}>
          <option value="">{spaceName} (top level)</option>
          {options.map((option) => (
            <option key={option.id} value={option.id}>
              {option.label}
            </option>
          ))}
        </Select>

        <footer className={share.footer}>
          <span className={share.footerNote}>Opens straight in the editor.</span>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            icon={<FilePlus2 size={14} />}
            disabled={busy || !title.trim()}
            onClick={() => void create()}
          >
            Create page
          </Button>
        </footer>
      </div>
    </div>
  );
}
