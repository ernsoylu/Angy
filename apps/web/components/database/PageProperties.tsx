"use client";

import { useState } from "react";
import type { PropertyDto, PropertyValueDto } from "@angy/shared";
import { Button } from "../ui/Button";
import { useToast } from "../ui/ToastProvider";
import shell from "../shell/shell.module.css";
import styles from "./database.module.css";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

/** The value as the API takes it: everything is text, cast by the property's type. */
function asText(property: PropertyDto, value: PropertyValueDto | undefined): string {
  if (!value) return "";
  switch (property.type) {
    case "NUMBER":
      return value.number === null ? "" : String(value.number);
    case "DATE":
      return value.date?.slice(0, 10) ?? "";
    case "CHECKBOX":
      return value.checkbox ? "true" : "false";
    case "USER":
      return value.userId ?? "";
    default:
      return value.text ?? "";
  }
}

/**
 * This page's property values (V2 H5.3, ADR 0013) — the row's own cells.
 *
 * Values are edited *here*, on the page they belong to, and never in the table
 * that lists them. That is what keeps the view read-only: a table that writes
 * back is a projection being edited, which is the mistake hard rule 2 exists
 * to prevent.
 */
export function PageProperties({
  pageId,
  properties,
  initial,
  canEdit,
}: {
  pageId: string;
  properties: PropertyDto[];
  initial: PropertyValueDto[];
  canEdit: boolean;
}) {
  const { toast } = useToast();
  const [draft, setDraft] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      properties.map((property) => [
        property.id,
        asText(
          property,
          initial.find((value) => value.propertyId === property.id),
        ),
      ]),
    ),
  );
  const [saved, setSaved] = useState(draft);
  const [busy, setBusy] = useState(false);

  if (properties.length === 0) return null;
  const dirty = properties.some((property) => draft[property.id] !== saved[property.id]);

  async function save() {
    setBusy(true);
    try {
      const res = await fetch(`${API_URL}/pages/${pageId}/properties`, {
        method: "PUT",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          values: properties
            .filter((property) => draft[property.id] !== saved[property.id])
            // An emptied field clears the value rather than storing "".
            .map((property) => ({
              propertyId: property.id,
              value: draft[property.id] === "" ? null : draft[property.id],
            })),
        }),
      });
      const body = await res.json();
      if (!body.success) throw new Error(body.error?.message ?? "Could not save");
      setSaved(draft);
      toast("success", "Properties saved");
    } catch (err) {
      toast("error", "Could not save properties", err instanceof Error ? err.message : undefined);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={shell.railGroup} data-testid="page-properties">
      <div className="t-caption">Properties</div>
      {properties.map((property) => {
        const value = draft[property.id] ?? "";
        const set = (next: string) => setDraft((prev) => ({ ...prev, [property.id]: next }));
        return (
          <label key={property.id} className={styles.field}>
            <span className={styles.fieldName}>{property.name}</span>
            {property.type === "CHECKBOX" ? (
              <input
                type="checkbox"
                checked={value === "true"}
                disabled={!canEdit}
                onChange={(event) => set(event.target.checked ? "true" : "false")}
              />
            ) : property.type === "SELECT" ? (
              <select
                className={styles.input}
                value={value}
                disabled={!canEdit}
                onChange={(event) => set(event.target.value)}
              >
                <option value="">—</option>
                {property.options.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            ) : (
              <input
                className={styles.input}
                type={property.type === "NUMBER" ? "number" : property.type === "DATE" ? "date" : "text"}
                value={value}
                disabled={!canEdit}
                onChange={(event) => set(event.target.value)}
              />
            )}
          </label>
        );
      })}
      {canEdit && (
        <Button variant="secondary" disabled={!dirty || busy} onClick={() => void save()}>
          {busy ? "Saving…" : "Save properties"}
        </Button>
      )}
    </div>
  );
}
