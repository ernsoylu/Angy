"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, Trash2, X } from "lucide-react";
import {
  FILTER_OPS,
  type DatabaseViewDto,
  type PropertyDto,
  type PropertyFilterDto,
  type PropertySortDto,
} from "@angy/shared";
import { useEscape } from "../../lib/useEscape";
import { Button } from "../ui/Button";
import { IconButton } from "../ui/IconButton";
import { useToast } from "../ui/ToastProvider";
import share from "../share/share.module.css";
import styles from "./database.module.css";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

const OP_LABEL: Record<(typeof FILTER_OPS)[number], string> = {
  equals: "is",
  contains: "contains",
  gt: "is after / greater than",
  lt: "is before / less than",
  is_empty: "is empty",
  not_empty: "is not empty",
};

const ORDERED = new Set(["NUMBER", "DATE"]);

/**
 * Turn a page into a database, or reconfigure the one it already is
 * (V2 H5.3, ADR 0013).
 *
 * The view is columns, filters and sorts over the page's children — never a
 * container of its own. Removing it removes the table and nothing else: the
 * children were pages before and stay pages after.
 */
export function DatabaseDialog({
  pageId,
  properties,
  view,
  onClose,
}: {
  pageId: string;
  properties: PropertyDto[];
  view: DatabaseViewDto | null;
  onClose: () => void;
}) {
  useEscape(onClose);
  const router = useRouter();
  const { toast } = useToast();

  const [columns, setColumns] = useState<string[]>(view?.columns.map((c) => c.id) ?? []);
  const [filters, setFilters] = useState<PropertyFilterDto[]>(view?.filters ?? []);
  const [sorts, setSorts] = useState<PropertySortDto[]>(view?.sorts ?? []);
  const [busy, setBusy] = useState(false);

  const propertyById = new Map(properties.map((property) => [property.id, property]));

  async function send(method: "PUT" | "DELETE") {
    setBusy(true);
    try {
      const res = await fetch(`${API_URL}/pages/${pageId}/database`, {
        method,
        credentials: "include",
        headers: { "content-type": "application/json" },
        ...(method === "PUT" ? { body: JSON.stringify({ columns, filters, sorts }) } : {}),
      });
      const body = await res.json();
      if (!body.success) throw new Error(body.error?.message ?? "Could not save the view");
      router.refresh();
      onClose();
    } catch (err) {
      toast("error", "Could not save the view", err instanceof Error ? err.message : undefined);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className={share.overlay}
      role="presentation"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className={share.dialog} role="dialog" aria-label="Database view">
        <header className={share.header}>
          <div>
            <h2 className={share.title}>Database view</h2>
            <div className={share.rowMeta}>
              This page&rsquo;s child pages, as a table. Rows are pages — open one to edit its
              values.
            </div>
          </div>
          <IconButton label="Close" onClick={onClose}>
            <X size={16} />
          </IconButton>
        </header>

        {properties.length === 0 ? (
          <p className={styles.note}>
            This space has no properties yet. Add one in space settings before building a view.
          </p>
        ) : (
          <>
            <div className={styles.sectionLabel}>Columns</div>
            {properties.map((property) => (
              <label key={property.id} className={styles.checkboxRow}>
                <input
                  type="checkbox"
                  checked={columns.includes(property.id)}
                  onChange={(event) =>
                    setColumns((prev) =>
                      event.target.checked
                        ? [...prev, property.id]
                        : prev.filter((id) => id !== property.id),
                    )
                  }
                />
                {property.name}
                <span className={styles.empty}>{property.type.toLowerCase()}</span>
              </label>
            ))}

            <div className={styles.sectionLabel}>Filters</div>
            {filters.map((filter, index) => {
              const property = propertyById.get(filter.propertyId);
              const needsValue = filter.op !== "is_empty" && filter.op !== "not_empty";
              return (
                <div key={`${filter.propertyId}-${index}`} className={styles.row}>
                  <select
                    className={styles.input}
                    aria-label="Filter property"
                    value={filter.propertyId}
                    onChange={(event) =>
                      setFilters((prev) =>
                        prev.map((entry, at) =>
                          at === index ? { ...entry, propertyId: event.target.value } : entry,
                        ),
                      )
                    }
                  >
                    {properties.map((option) => (
                      <option key={option.id} value={option.id}>
                        {option.name}
                      </option>
                    ))}
                  </select>
                  <select
                    className={styles.input}
                    aria-label="Filter operator"
                    value={filter.op}
                    onChange={(event) =>
                      setFilters((prev) =>
                        prev.map((entry, at) =>
                          at === index
                            ? { ...entry, op: event.target.value as PropertyFilterDto["op"] }
                            : entry,
                        ),
                      )
                    }
                  >
                    {FILTER_OPS
                      // "greater than" on a text property is a filter the API
                      // refuses; not offering it beats explaining it.
                      .filter(
                        (op) =>
                          !(op === "gt" || op === "lt") ||
                          (property !== undefined && ORDERED.has(property.type)),
                      )
                      .map((op) => (
                        <option key={op} value={op}>
                          {OP_LABEL[op]}
                        </option>
                      ))}
                  </select>
                  {needsValue && (
                    <input
                      className={styles.input}
                      aria-label="Filter value"
                      style={{ width: 120 }}
                      value={filter.value ?? ""}
                      onChange={(event) =>
                        setFilters((prev) =>
                          prev.map((entry, at) =>
                            at === index ? { ...entry, value: event.target.value } : entry,
                          ),
                        )
                      }
                    />
                  )}
                  <IconButton
                    label="Remove filter"
                    onClick={() => setFilters((prev) => prev.filter((_, at) => at !== index))}
                  >
                    <Trash2 size={14} />
                  </IconButton>
                </div>
              );
            })}
            <Button
              variant="secondary"
              icon={<Plus size={14} />}
              onClick={() =>
                setFilters((prev) => [
                  ...prev,
                  { propertyId: properties[0].id, op: "equals", value: "" },
                ])
              }
            >
              Add filter
            </Button>

            <div className={styles.sectionLabel}>Sort</div>
            {sorts.map((sort, index) => (
              <div key={`${sort.propertyId}-${index}`} className={styles.row}>
                <select
                  className={styles.input}
                  aria-label="Sort property"
                  value={sort.propertyId}
                  onChange={(event) =>
                    setSorts((prev) =>
                      prev.map((entry, at) =>
                        at === index ? { ...entry, propertyId: event.target.value } : entry,
                      ),
                    )
                  }
                >
                  {properties.map((option) => (
                    <option key={option.id} value={option.id}>
                      {option.name}
                    </option>
                  ))}
                </select>
                <select
                  className={styles.input}
                  aria-label="Sort direction"
                  value={sort.direction}
                  onChange={(event) =>
                    setSorts((prev) =>
                      prev.map((entry, at) =>
                        at === index
                          ? { ...entry, direction: event.target.value as "asc" | "desc" }
                          : entry,
                      ),
                    )
                  }
                >
                  <option value="asc">ascending</option>
                  <option value="desc">descending</option>
                </select>
                <IconButton
                  label="Remove sort"
                  onClick={() => setSorts((prev) => prev.filter((_, at) => at !== index))}
                >
                  <Trash2 size={14} />
                </IconButton>
              </div>
            ))}
            {sorts.length < 3 && (
              <Button
                variant="secondary"
                icon={<Plus size={14} />}
                onClick={() =>
                  setSorts((prev) => [
                    ...prev,
                    { propertyId: properties[0].id, direction: "asc" as const },
                  ])
                }
              >
                Add sort
              </Button>
            )}

            <footer className={share.footer}>
              {view && (
                <Button variant="secondary" disabled={busy} onClick={() => void send("DELETE")}>
                  Remove view
                </Button>
              )}
              <Button disabled={busy} onClick={() => void send("PUT")}>
                {view ? "Save view" : "Create view"}
              </Button>
            </footer>
          </>
        )}
      </div>
    </div>
  );
}
