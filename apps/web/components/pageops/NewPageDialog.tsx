"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { FilePlus2, X } from "lucide-react";
import type { PageTemplateDto } from "@angy/shared";
import type { TreeNode } from "../../lib/tree";
import { useEscape } from "../../lib/useEscape";
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
  const [templateId, setTemplateId] = useState<string>("");
  const [templates, setTemplates] = useState<PageTemplateDto[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEscape(onClose);

  // Templates are optional scaffolding, so a failed lookup leaves the dialog
  // fully usable rather than blocking page creation on them.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(`${API_URL}/spaces/${spaceId}/templates`, {
          credentials: "include",
        });
        const body = await res.json();
        if (!cancelled && body.success) setTemplates(body.data as PageTemplateDto[]);
      } catch {
        /* no templates offered */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [spaceId]);

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
          templateId: templateId || null,
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

  /*
   * Click-outside-to-dismiss is a mouse convenience; the keyboard path is
   * Escape, wired above by useEscape. Marked presentational so that is
   * explicit — an undeclared click handler on a bare div reads as an
   * interactive element with no keyboard equivalent.
   *
   * Dismissing only when the click landed on the overlay *itself* also removes
   * the need for a stopPropagation handler on the dialog, which was a second
   * non-interactive element carrying a click listener.
   */
  return (
    <div
      className={share.overlay}
      role="presentation"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className={share.dialog} role="dialog" aria-label="New page" style={{ width: 480 }}>
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

        {templates.length > 0 && (
          <>
            <div className="t-caption">Template</div>
            <Select value={templateId} onChange={(e) => setTemplateId(e.target.value)}>
              <option value="">Blank page</option>
              {templates.map((template) => (
                <option key={template.id} value={template.id}>
                  {template.name}
                </option>
              ))}
            </Select>
          </>
        )}

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
