"use client";

import { useState } from "react";
import { FolderPlus } from "lucide-react";
import { Button } from "../ui/Button";
import { NewSpaceDialog } from "./NewSpaceDialog";

/**
 * Entry point for the create-space dialog. It lives in the top bar, not on the
 * space home: creating a space is the one action that is not about the space
 * you are looking at, so tying it to one screen made it unreachable from the
 * other nine.
 */
export function NewSpaceButton() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="secondary" icon={<FolderPlus size={14} />} onClick={() => setOpen(true)}>
        New space
      </Button>
      {open && <NewSpaceDialog onClose={() => setOpen(false)} />}
    </>
  );
}
