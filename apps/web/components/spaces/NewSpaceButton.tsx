"use client";

import { useState } from "react";
import { FolderPlus } from "lucide-react";
import { Button } from "../ui/Button";
import { NewSpaceDialog } from "./NewSpaceDialog";

/** Entry point for frame 13, which opens over the space home. */
export function NewSpaceButton() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button
        variant="secondary"
        icon={<FolderPlus size={14} />}
        style={{ width: "100%" }}
        onClick={() => setOpen(true)}
      >
        New space
      </Button>
      {open && <NewSpaceDialog onClose={() => setOpen(false)} />}
    </>
  );
}
