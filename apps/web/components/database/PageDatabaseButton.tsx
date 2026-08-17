"use client";

import { useState } from "react";
import { Table2 } from "lucide-react";
import type { DatabaseViewDto, PropertyDto } from "@angy/shared";
import { Button } from "../ui/Button";
import { DatabaseDialog } from "./DatabaseDialog";

/**
 * The way into a page's database view (V2 H5.3). Sits with the other page
 * actions rather than in the article, because turning a page into a table is
 * something you do *to* the page — it changes how its children are presented,
 * not what the page says.
 */
export function PageDatabaseButton({
  pageId,
  properties,
  view,
}: {
  pageId: string;
  properties: PropertyDto[];
  view: DatabaseViewDto | null;
}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button variant="secondary" icon={<Table2 size={14} />} onClick={() => setOpen(true)}>
        {view ? "Edit database view" : "Add database view"}
      </Button>
      {open && (
        <DatabaseDialog
          pageId={pageId}
          properties={properties}
          view={view}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}
