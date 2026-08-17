"use client";

import { useEffect, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { propertyTypeSchema, type PropertyDto, type PropertyTypeDto } from "@angy/shared";
import { Button } from "../ui/Button";
import { IconButton } from "../ui/IconButton";
import { Input } from "../ui/Input";
import { Select } from "../ui/Select";
import { useToast } from "../ui/ToastProvider";
import styles from "./space-settings.module.css";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

const TYPES = propertyTypeSchema.options;

/**
 * The space's property vocabulary (V2 H5.3, ADR 0013) — the schema every
 * database view in the space draws its columns from.
 *
 * It lives here for the same reason tag admin does: properties are
 * space-scoped, and this is the space's only administrative surface. Coining
 * one takes EDIT (a vocabulary only admins can extend stays empty), but
 * deleting one takes every page's value with it, so that stays ADMIN — which
 * this whole screen already is.
 */
export function PropertyAdmin({ spaceId }: { spaceId: string }) {
  const { toast } = useToast();
  const [properties, setProperties] = useState<PropertyDto[]>([]);
  const [name, setName] = useState("");
  const [type, setType] = useState<PropertyTypeDto>("TEXT");
  const [options, setOptions] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void fetch(`${API_URL}/spaces/${spaceId}/properties`, { credentials: "include" })
      .then((res) => res.json())
      .then((body) => {
        if (body.success) setProperties(body.data as PropertyDto[]);
      })
      .catch(() => undefined);
  }, [spaceId]);

  async function create() {
    setBusy(true);
    try {
      const res = await fetch(`${API_URL}/spaces/${spaceId}/properties`, {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          type,
          options:
            type === "SELECT"
              ? options
                  .split(",")
                  .map((option) => option.trim())
                  .filter(Boolean)
              : [],
        }),
      });
      const body = await res.json();
      if (!body.success) throw new Error(body.error?.message ?? "Could not add the property");
      setProperties((prev) => [...prev, body.data as PropertyDto]);
      setName("");
      setOptions("");
      toast("success", "Property added");
    } catch (err) {
      toast("error", "Could not add the property", err instanceof Error ? err.message : undefined);
    } finally {
      setBusy(false);
    }
  }

  async function remove(property: PropertyDto) {
    setBusy(true);
    try {
      const res = await fetch(`${API_URL}/spaces/${spaceId}/properties/${property.id}`, {
        method: "DELETE",
        credentials: "include",
      });
      const body = await res.json();
      if (!body.success) throw new Error(body.error?.message ?? "Could not delete");
      setProperties((prev) => prev.filter((entry) => entry.id !== property.id));
      toast("success", `"${property.name}" removed`);
    } catch (err) {
      toast("error", "Could not delete the property", err instanceof Error ? err.message : undefined);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className={styles.card} data-testid="property-admin">
      <div className="t-caption">Page properties</div>
      <p className={styles.hint}>
        Typed metadata on pages, and the columns a database view can show. Deleting a property
        deletes its value on every page in this space.
      </p>

      {properties.length === 0 ? (
        <p className={styles.hint}>No properties yet.</p>
      ) : (
        properties.map((property) => (
          <div key={property.id} className={styles.memberRow}>
            <span>
              <strong>{property.name}</strong> <span className={styles.hint}>{property.type}</span>
              {property.options.length > 0 && (
                <span className={styles.hint}> · {property.options.join(", ")}</span>
              )}
            </span>
            <IconButton label={`Delete ${property.name}`} onClick={() => void remove(property)}>
              <Trash2 size={14} />
            </IconButton>
          </div>
        ))
      )}

      <div className={styles.inviteRow}>
        <Input
          aria-label="Property name"
          placeholder="Status"
          value={name}
          onChange={(event) => setName(event.target.value)}
        />
        <Select
          aria-label="Property type"
          value={type}
          onChange={(event) => setType(event.target.value as PropertyTypeDto)}
        >
          {TYPES.map((option) => (
            <option key={option} value={option}>
              {option.toLowerCase()}
            </option>
          ))}
        </Select>
        {type === "SELECT" && (
          <Input
            aria-label="Options, comma separated"
            placeholder="Todo, Doing, Done"
            value={options}
            onChange={(event) => setOptions(event.target.value)}
          />
        )}
        <Button
          variant="secondary"
          icon={<Plus size={14} />}
          disabled={busy || name.trim().length === 0}
          onClick={() => void create()}
        >
          Add
        </Button>
      </div>
    </section>
  );
}
