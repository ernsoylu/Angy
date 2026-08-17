import Link from "next/link";
import { Check, Minus } from "lucide-react";
import type { DatabaseViewDto, PropertyDto, PropertyValueDto } from "@angy/shared";
import styles from "./database.module.css";

/**
 * A database view (V2 H5.3, ADR 0013): this page's children as a table.
 *
 * Server-rendered with the page, like backlinks — the rows are already
 * filtered and sorted by the time this runs, so no JS reaches the read path.
 *
 * Read-only on purpose. Editing a cell here would mean writing back through a
 * view into a page's own metadata, and the first slice deliberately keeps the
 * write on the row's own page: the title in each row *is* the way in.
 */
function Cell({ property, value }: { property: PropertyDto; value: PropertyValueDto | undefined }) {
  if (!value) return <span className={styles.empty}>—</span>;

  switch (property.type) {
    case "CHECKBOX":
      return value.checkbox ? (
        <Check size={14} aria-label="yes" />
      ) : (
        <Minus size={14} className={styles.empty} aria-label="no" />
      );
    case "NUMBER":
      return value.number === null ? (
        <span className={styles.empty}>—</span>
      ) : (
        <span className={styles.number}>{value.number}</span>
      );
    case "DATE":
      return value.date === null ? (
        <span className={styles.empty}>—</span>
      ) : (
        // Fixed format, not the viewer's locale: the reader is server-rendered
        // and a locale-formatted date would differ between the HTML and any
        // later hydration.
        <span>{value.date.slice(0, 10)}</span>
      );
    case "USER":
      return value.userName ? <span>{value.userName}</span> : <span className={styles.empty}>—</span>;
    case "SELECT":
      return value.text ? (
        <span className={styles.chip}>{value.text}</span>
      ) : (
        <span className={styles.empty}>—</span>
      );
    default:
      return value.text ? <span>{value.text}</span> : <span className={styles.empty}>—</span>;
  }
}

export function DatabaseTable({ view, spaceKey }: { view: DatabaseViewDto; spaceKey: string }) {
  if (view.columns.length === 0 && view.rows.length === 0) return null;

  return (
    <section className={styles.wrap} data-testid="database-view">
      <div className={styles.scroll}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th scope="col">Page</th>
              {view.columns.map((column) => (
                <th key={column.id} scope="col">
                  {column.name}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {view.rows.map((row) => (
              <tr key={row.pageId}>
                <th scope="row" className={styles.rowTitle}>
                  <Link href={`/s/${spaceKey}/${row.pageId}`}>{row.title}</Link>
                </th>
                {view.columns.map((column) => (
                  <td key={column.id}>
                    <Cell
                      property={column}
                      value={row.values.find((value) => value.propertyId === column.id)}
                    />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {view.rows.length === 0 && (
        <p className={styles.note}>
          No child pages match this view{view.filters.length > 0 ? "'s filters" : ""}.
        </p>
      )}
      {/* Say what was left out rather than quietly showing a short table. */}
      {view.total > view.rows.length && (
        <p className={styles.note}>
          Showing {view.rows.length} of {view.total} rows.
        </p>
      )}
    </section>
  );
}
