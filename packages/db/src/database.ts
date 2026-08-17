import type { PageProperty, Prisma, PrismaClient, PropertyType } from "@prisma/client";
import { filterReadablePages } from "./permissions.js";
import {
  DATABASE_ROW_LIMIT,
  type DatabaseViewDto,
  type PropertyDto,
  type PropertyValueDto,
} from "@angy/shared";

/**
 * Databases-in-pages, first slice (V2 H5.3, ADR 0013).
 *
 * A database is a *view*: its rows are the page's children, which are Pages
 * with their own permissions, history, search and trash. Nothing here creates
 * a second content model — it reads page metadata and orders it.
 */

export interface PropertyFilter {
  propertyId: string;
  op: "equals" | "contains" | "gt" | "lt" | "is_empty" | "not_empty";
  value: string | null;
}

export interface PropertySort {
  propertyId: string;
  direction: "asc" | "desc";
}

export interface DatabaseCell {
  propertyId: string;
  text: string | null;
  number: number | null;
  date: Date | null;
  checkbox: boolean | null;
  userId: bigint | null;
}

export interface DatabaseRow {
  pageId: string;
  title: string;
  updatedAt: Date;
  cells: DatabaseCell[];
}

/** Which column of `page_property_value` a type lives in. */
const COLUMN: Record<PropertyType, keyof Prisma.PagePropertyValueWhereInput> = {
  TEXT: "textValue",
  SELECT: "textValue",
  NUMBER: "numberValue",
  DATE: "dateValue",
  CHECKBOX: "checkboxValue",
  USER: "userValue",
};

/**
 * Cast the string a filter arrives as into the column's type. Anything that
 * does not parse makes the filter unsatisfiable rather than being dropped: a
 * filter nobody can see failing is how a view quietly shows the wrong rows.
 */
function cast(type: PropertyType, value: string): unknown {
  switch (type) {
    case "NUMBER": {
      const parsed = Number(value);
      return Number.isFinite(parsed) ? parsed : null;
    }
    case "DATE": {
      const parsed = new Date(value);
      return Number.isNaN(parsed.getTime()) ? null : parsed;
    }
    case "CHECKBOX":
      return value === "true";
    case "USER": {
      return /^\d+$/.test(value) ? BigInt(value) : null;
    }
    default:
      return value;
  }
}

/**
 * One filter as a Prisma predicate on the page.
 *
 * Filters run in SQL, not in application code. That is the whole reason the
 * values are typed columns: ADR 0013 rejected building this on a full scan
 * filtered in the API, which is fine at fifty rows and unusable at five
 * thousand.
 */
function predicate(
  filter: PropertyFilter,
  property: PageProperty,
): Prisma.PageWhereInput | null {
  const column = COLUMN[property.type];
  const propertyId = property.id;

  if (filter.op === "is_empty") {
    return { NOT: { propertyValues: { some: { propertyId, [column]: { not: null } } } } };
  }
  if (filter.op === "not_empty") {
    return { propertyValues: { some: { propertyId, [column]: { not: null } } } };
  }

  if (filter.value === null) return null;
  const value = cast(property.type, filter.value);
  // An uncastable value cannot match anything — say so rather than ignoring it.
  if (value === null) return { id: { in: [] } };

  if (filter.op === "contains") {
    // Only text has a substring; anything else falls back to equality rather
    // than pretending "contains 3" means something for a number.
    return column === "textValue"
      ? {
          propertyValues: {
            some: { propertyId, textValue: { contains: String(value), mode: "insensitive" } },
          },
        }
      : { propertyValues: { some: { propertyId, [column]: value } } };
  }

  if (filter.op === "gt" || filter.op === "lt") {
    if (column !== "numberValue" && column !== "dateValue") return null;
    return { propertyValues: { some: { propertyId, [column]: { [filter.op]: value } } } };
  }

  return { propertyValues: { some: { propertyId, [column]: value } } };
}

/** Whichever column the cell's property fills, or null for an unset cell. */
function cellValue(cell: DatabaseCell | undefined): string | number | Date | boolean | bigint | null {
  return cell?.text ?? cell?.number ?? cell?.date ?? cell?.checkbox ?? cell?.userId ?? null;
}

function compare(
  av: Exclude<ReturnType<typeof cellValue>, null>,
  bv: Exclude<ReturnType<typeof cellValue>, null>,
): number {
  if (typeof av === "string" && typeof bv === "string") return av.localeCompare(bv);
  if (av instanceof Date && bv instanceof Date) return av.getTime() - bv.getTime();
  return Number(av) - Number(bv);
}

export interface DatabaseQuery {
  /**
   * Whose access decides which rows exist. Not optional: a row discloses a
   * page's title and its property values, and access to the *parent* does not
   * imply access to a child (see `queryDatabaseRows`).
   */
  userId: bigint;
  filters: readonly PropertyFilter[];
  sorts: readonly PropertySort[];
  limit: number;
}

/**
 * The rows of a database view: this page's live children, filtered in SQL,
 * filtered again by what the caller may read, and ordered by the view's sorts.
 *
 * **Access to the parent does not imply access to a child.** The first cut of
 * this skipped the read filter on the reasoning that page grants only ever
 * widen access, so a child of a readable page is readable. That is false:
 * `getEffectivePageLevel` resolves a grant on *that page*, with no walk up the
 * closure table — so a non-member of a private space, granted VIEW on one
 * page, cannot open its children. Without this filter the view would have
 * listed their titles, their property values and their count. It is the same
 * disclosure `filterReadablePages` was written for on the backlinks rail.
 *
 * `total` is therefore the count of rows *the caller may see*, not of rows
 * that matched: reporting "showing 2 of 5" would disclose the three it just
 * withheld.
 *
 * Sorting happens here rather than in SQL because ordering by a to-many
 * relation is not something Prisma expresses, and the alternative — a hand-
 * built ORDER BY over a LEFT JOIN — is dynamic SQL for a set already bounded
 * by one page's children.
 */
export async function queryDatabaseRows(
  prisma: PrismaClient,
  pageId: string,
  query: DatabaseQuery,
): Promise<{ rows: DatabaseRow[]; total: number }> {
  const referenced = [
    ...new Set([...query.filters, ...query.sorts].map((entry) => entry.propertyId)),
  ];
  const properties =
    referenced.length === 0
      ? []
      : await prisma.pageProperty.findMany({
          where: { id: { in: referenced.map((id) => BigInt(id)) } },
        });
  const byId = new Map(properties.map((property) => [property.id.toString(), property]));

  const where: Prisma.PageWhereInput = {
    parentId: pageId,
    deletedAt: null,
    AND: query.filters.flatMap((filter) => {
      const property = byId.get(filter.propertyId);
      if (!property) return [];
      const clause = predicate(filter, property);
      return clause ? [clause] : [];
    }),
  };

  const pages = await prisma.page.findMany({
    where,
    orderBy: [{ ord: "asc" }, { id: "asc" }],
    include: { propertyValues: true },
  });

  // One query for the whole candidate set, not one per row — the same reason
  // the backlinks rail resolves its list this way.
  const readable = await filterReadablePages(
    prisma,
    query.userId,
    pages.map((page) => page.id),
  );

  const rows: DatabaseRow[] = pages
    .filter((page) => readable.has(page.id))
    .map((page) => ({
      pageId: page.id,
      title: page.title,
      updatedAt: page.updatedAt,
      cells: page.propertyValues.map((value) => ({
        propertyId: value.propertyId.toString(),
        text: value.textValue,
        number: value.numberValue,
        date: value.dateValue,
        checkbox: value.checkboxValue,
        userId: value.userValue,
      })),
    }));

  // Applied in order, last sort first, so the first-named sort wins — the
  // order a reader means when they say "by status, then by date".
  for (const sort of [...query.sorts].reverse()) {
    if (!byId.has(sort.propertyId)) continue;
    rows.sort((a, b) => {
      const av = cellValue(a.cells.find((cell) => cell.propertyId === sort.propertyId));
      const bv = cellValue(b.cells.find((cell) => cell.propertyId === sort.propertyId));
      // Empty cells sort last in *either* direction, so the direction flip
      // happens after they are dealt with: a blank is not "smallest", it is
      // "not filled in", and floating those to the top of a descending sort
      // buries the rows most likely to need attention.
      if (av === null && bv === null) return 0;
      if (av === null) return 1;
      if (bv === null) return -1;
      const result = compare(av, bv);
      return sort.direction === "asc" ? result : -result;
    });
  }

  return { rows: rows.slice(0, query.limit), total: rows.length };
}

const toPropertyDto = (property: PageProperty): PropertyDto => ({
  id: property.id.toString(),
  name: property.name,
  type: property.type,
  options: property.options,
});

/** Display names for the USER cells in a set of values, in one query. */
async function userNames(
  prisma: PrismaClient,
  ids: readonly (bigint | null)[],
): Promise<Map<string, string>> {
  const wanted = [...new Set(ids.flatMap((id) => (id ? [id] : [])))];
  if (wanted.length === 0) return new Map();
  const users = await prisma.appUser.findMany({
    where: { id: { in: wanted } },
    select: { id: true, displayName: true },
  });
  return new Map(users.map((user) => [user.id.toString(), user.displayName]));
}

/**
 * One page's property values — the row's own cells, in the space's property
 * order. Shared by the API and the reader's RSC render, so a cell cannot look
 * one way through the API and another on the page.
 */
export async function getPageValues(
  prisma: PrismaClient,
  pageId: string,
): Promise<PropertyValueDto[]> {
  const values = await prisma.pagePropertyValue.findMany({
    where: { pageId },
    orderBy: { property: { ord: "asc" } },
  });
  const names = await userNames(
    prisma,
    values.map((value) => value.userValue),
  );

  return values.map((value) => ({
    propertyId: value.propertyId.toString(),
    text: value.textValue,
    number: value.numberValue,
    date: value.dateValue?.toISOString() ?? null,
    checkbox: value.checkboxValue,
    userId: value.userValue?.toString() ?? null,
    userName: value.userValue ? (names.get(value.userValue.toString()) ?? null) : null,
  }));
}

/**
 * A page's database view, or null if it is an ordinary page.
 *
 * Returns the DTO shape rather than rows for the caller to assemble, because
 * there are two callers — the REST endpoint and the reader's server render —
 * and a table that disagreed with its own API would be the worst of both.
 */
export async function getDatabaseView(
  prisma: PrismaClient,
  pageId: string,
  userId: bigint,
  limit: number = DATABASE_ROW_LIMIT,
): Promise<DatabaseViewDto | null> {
  const config = await prisma.pageDatabase.findUnique({ where: { pageId } });
  if (!config) return null;

  const filters = config.filters as unknown as PropertyFilter[];
  const sorts = config.sorts as unknown as PropertySort[];
  const properties = await prisma.pageProperty.findMany({ where: { id: { in: config.columns } } });
  const byId = new Map(properties.map((property) => [property.id.toString(), property]));
  // The array *is* the column order — a set of ids would not remember it.
  const columns = config.columns.flatMap((id) => {
    const property = byId.get(id.toString());
    return property ? [toPropertyDto(property)] : [];
  });

  const { rows, total } = await queryDatabaseRows(prisma, pageId, {
    userId,
    filters,
    sorts,
    limit,
  });
  const names = await userNames(
    prisma,
    rows.flatMap((row) => row.cells.map((cell) => cell.userId)),
  );

  return {
    columns,
    filters,
    sorts,
    total,
    rows: rows.map((row) => ({
      pageId: row.pageId,
      title: row.title,
      updatedAt: row.updatedAt.toISOString(),
      values: row.cells.map((cell) => ({
        propertyId: cell.propertyId,
        text: cell.text,
        number: cell.number,
        date: cell.date?.toISOString() ?? null,
        checkbox: cell.checkbox,
        userId: cell.userId?.toString() ?? null,
        userName: cell.userId ? (names.get(cell.userId.toString()) ?? null) : null,
      })),
    })),
  };
}
