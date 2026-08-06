"use client";

import { useState } from "react";
import { Plus } from "lucide-react";
import { Button } from "../ui/Button";
import { NewPageDialog } from "./NewPageDialog";

/**
 * The space header's New page action (frame 5). It opens the same dialog the
 * sidebar button does, but from a server-rendered page — hence its own client
 * boundary rather than lifting state into the shell.
 *
 * The parent picker starts empty: creating from the space header means "a new
 * top-level page", and the dialog lets you reparent from there.
 */
export function NewPageButton({
  spaceId,
  spaceKey,
  spaceName,
}: {
  spaceId: string;
  spaceKey: string;
  spaceName: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button icon={<Plus size={14} />} onClick={() => setOpen(true)}>
        New page
      </Button>
      {open && (
        <NewPageDialog
          spaceId={spaceId}
          spaceKey={spaceKey}
          spaceName={spaceName}
          tree={[]}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}
