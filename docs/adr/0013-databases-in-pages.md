# ADR 0013: Databases-in-Pages Are Deferred, and Rows Will Be Pages

**Status:** Accepted (2026-08-07) · **first slice implemented** (2026-08-17, V2 H5.3)

> **What was built, and what the decision got wrong.** The first slice landed as
> described — `page_property` per space, typed values per page, one read-only
> table view over a page's children, filter and sort. Two things this ADR did
> not anticipate:
>
> 1. **A database cannot be a block.** The static renderer is a pure JSON→HTML
>    function with no database access, so a `database` node in the document
>    could never carry live rows. The table renders as its own server-rendered
>    section after the article — which keeps the invariant *and* keeps the read
>    path JavaScript-free.
> 2. **"Rows inherit page permissions" does not mean "rows are visible".** The
>    consequences below say permissions "work already", and they do — but page
>    grants resolve per page, with no walk up the closure table, so a caller
>    who can open the database page may not be able to open its children. The
>    view read-filters its rows for that reason, and counts only what survived.
>
> Ordering, listed below as unsolved, was solved first (H5.1): `page.ord`, a
> fractional index, which the sidebar uses too.

## Context

Notion's defining feature is the database-in-a-page: a collection with typed
properties, rendered through interchangeable views (table, board, calendar,
gallery), each with its own filters, sorts and grouping. Anyone arriving from
Notion expects it, and it was requested directly.

The roadmap already lists it under V2+, but "not yet" is not a decision — it
leaves the *shape* unsettled, and the shape is what determines whether the V1
data model can host it at all. Two of Angy's hard rules bear on it directly:

- **Rule 2: never create a block relational table.** Blocks live in
  `page.document_json` and the Y.Doc, not in rows.
- **Rule 4: one Y.Doc per page, always.**

A database wants its rows to be *queryable* — filtered, sorted, aggregated
across thousands of entries. Blocks buried in a JSONB payload are not
queryable in any way that survives contact with a real dataset. So a naive
implementation puts rows in a table and breaks rule 2 on day one.

## Decision

**Defer the feature, and settle now that a database row is a Page.**

Not a block, not a row in a `database_row` table. A row is a `page` — with its
own id, its own Y.Doc, its own permissions, its own place in the closure table.
A "database" is a *view* over a set of pages plus a property schema describing
how to interpret their metadata.

This is also how Notion actually works: opening a database row opens a page,
because it is one.

Three consequences fall out immediately:

- **Rule 2 stays intact.** No block table appears, because rows were never
  blocks. The queryable part is page metadata, which is already relational.
- **Rule 4 stays intact.** Each row is a page and therefore has exactly one
  Y.Doc. A database does not introduce a second document model.
- **Permissions, history, search, trash and move all work already.** A row
  inherits every page behaviour rather than needing a parallel implementation
  of each. This is the single largest argument for the choice: the alternative
  is reimplementing page-level permissions for rows, which is exactly the
  mistake ADR 0001 avoided for blocks.

The property schema (name, type, options) is new relational data, and is small
and genuinely relational — a `page_property` definition per space plus typed
values per page. This does not violate rule 2 because properties are page
metadata, not blocks.

## Consequences

- **It needs `block_index` first, or something like it.** Filtering and sorting
  a view means querying page metadata, and today the only projections are
  `document_json`, `rendered_html` and `text_extract` — none queryable by
  property. The `block_index` projection table already deferred to V2 is the
  natural home, and databases should not start before it exists.
- **Ordering across a view is unsolved.** Notion rows carry an explicit order
  that survives concurrent inserts. The closure table gives hierarchy, not
  sibling order. Whatever answer is chosen (fractional indexing is the usual
  one) must be CRDT-safe, since two people can insert into the same view at
  once.
- **A page becomes heavier.** Every row carrying a Y.Doc means a 500-row
  database is 500 Y.Docs and 500 S3 objects. Acceptable — they are created
  lazily and compaction already bounds them — but it rules out treating rows as
  cheap ephemeral records, and a bulk import of 50k rows is not a thing this
  design does well.
- **The first slice should be a read-only table view**, not four view types:
  page properties as structured metadata, one table view, filter and sort. It
  is independently useful, it proves the property model against real data, and
  it is reversible if the model turns out wrong. Boards, calendars, relations
  and rollups all sit downstream of that answer.

## Sequencing

Explicitly **after V1 is finished and operationally sound**. At the time of
writing the deployment has no restore drill, no rotated credentials, and Wave
G's operational half is open. A feature of this size built on an install whose
backups have never been tested is the wrong order of work — the failure mode is
not "the feature is late", it is "the data is gone and the feature made it
bigger".

## Alternatives rejected

- **Rows as blocks in the parent's Y.Doc.** The obvious reading of "a database
  is a block". It makes every row edit a write to one shared document, puts a
  hard ceiling on collection size (the whole Y.Doc loads to edit one cell), and
  leaves rows unqueryable and unpermissionable. Breaks rule 2 in substance even
  where it obeys it in form.
- **A dedicated `database_row` table.** Queryable and cheap, but forks the
  content model: rows would need their own permission, history, search and
  trash implementations, all parallel to the page ones and all subtly
  different. This is precisely the duplication ADR 0001 rejected.
- **Building it now, before `block_index`.** Would mean filtering in
  application code over a full scan — fine at 50 rows, unusable at 5,000, and
  discovered only after the UI is built on top of it.
