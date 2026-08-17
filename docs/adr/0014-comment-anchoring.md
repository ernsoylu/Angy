# ADR 0014: Comments Anchor in the Y.Doc and Live in Postgres

**Status:** Accepted (2026-08-17)

## Context

Comments are the one Confluence-class feature Angy has never had. The roadmap
files them under V3 while flagging them as a strong V2 candidate, and the
argument for pulling them forward got stronger when the inbox shipped (V2 H3):
notifications, the bell menu and read-access-at-serve-time already exist, so a
comment notification is a new enum value rather than a subsystem.

What was never settled is the part that decides everything else: **what a
comment is attached to.** A page is a CRDT document that several people edit at
once, and the text a comment refers to moves — someone types a paragraph above
it, someone else deletes half the sentence. An anchor that is a character
offset is wrong within seconds of being written.

Three constraints bound the answer:

- **Hard rule 2**: no block relational table. A comment cannot anchor to "block
  id 47", because blocks are not rows and have no stable id outside the
  document.
- **The static renderer is a pure JSON→HTML function** (V2 H1). It must not
  query the database, so whatever the reader paints has to be derivable from
  `document_json` alone.
- **Hard rule 4**: one Y.Doc per page. Whatever comments are, they do not get
  their own documents.

## Decision

**The anchor is a mark inside the page's Y.Doc; the thread and its replies are
ordinary Postgres rows.**

A comment thread is created by wrapping the selected text in a `comment` mark
carrying nothing but a thread id:

```
{ "type": "text", "text": "the sentence in question",
  "marks": [{ "type": "comment", "attrs": { "threadId": "…" } }] }
```

The mark is part of the shared schema in `@angy/blocks`, so both halves of the
isomorphic-block invariant see it: the editor renders it as a highlight, and
the static renderer emits `<mark data-thread-id="…">` into `rendered_html`
without knowing whether that thread still exists.

Everything else about a comment — who wrote it, when, the body, the replies,
resolved or not — is relational: `comment_thread` and `comment`.

### Why the anchor is a mark and not a position

A mark *is* a position, expressed in the only coordinate system that survives
concurrent editing: the text itself. Yjs already moves marks with the
characters they cover, splits them when text is inserted in the middle, and
drops them when the text is deleted. That is the entire anchoring problem, and
the CRDT solves it for free. A stored offset, a `RelativePosition` blob, or a
"paragraph 3, character 12" tuple would each need repair logic that Yjs already
has.

### Why the bodies are not documents

A comment body is plain text, in a row, written once. Giving each one a Y.Doc
would multiply every piece of machinery the page document carries — an S3
object, a compaction candidate, a revision history, a Hocuspocus room — by the
number of comments in the workspace, to make a two-line remark collaboratively
editable while it is being typed. Threads are queryable this way too: "open
threads on this page", "comments by this person", the inbox.

### No comment action ever writes to the document

Creating a thread writes the mark (that is an edit, and the person is in the
editor). **Resolving, replying to and deleting a thread do not touch the Y.Doc
at all.** The consequences of that are the reason for it:

- A resolve does not produce a Yjs update, so it does not produce a revision
  checkpoint, a projection rebuild, an S3 write or a "modified by" change.
  Reading a page's history should show edits, not conversations.
- It follows that a mark can outlive its thread. **A mark whose thread is gone
  renders as plain text** — the reader and the editor both paint only marks
  they have a live thread for. Dangling marks are inert, cost a handful of
  bytes, and vanish the next time someone edits that text. This is strictly
  better than the alternative, which is a fan-out of document writes (load the
  Y.Doc, strip a mark, checkpoint, re-project) every time somebody dismisses a
  comment.

The mirror case — a thread whose text was deleted — is detected by the
projection worker, which already walks `document_json` on every rebuild. A
thread whose mark is no longer in the document is flagged `orphaned_at` and
shown in the rail as commenting on removed text, rather than disappearing with
the sentence and taking the discussion with it.

## Consequences

- **Comments are page-scoped for permissions.** Reading a thread requires VIEW
  on its page, writing one requires EDIT. There is no comment-level ACL, and a
  comment inherits revocation from its page the way everything else does.
- **Notifications reuse H3 wholesale.** `COMMENT` joins `MENTION` in
  `notification_kind`, and the unique `(user, kind, page)` key collapses ten
  comments on one page into one inbox row — the same judgement mentions
  already make. Recipients are the thread's participants plus the page's last
  editor, minus whoever is doing the talking.
- **Threads survive a projection rebuild**, because nothing about them is
  derived from the document except the orphan flag, which is recomputed.
- **The reader stays JS-free.** Highlights are in `rendered_html`; the rail is
  server-rendered with the rest of the page. Only replying needs a client.
- **A copy-paste duplicates a mark.** Two ranges then point at one thread,
  which is the honest reading of what copying commented text means — the
  alternative is silently dropping the mark, and Notion does the same thing.
- **Search does not index comments.** `text_extract` is built from the document
  and comments are not in it. Finding a discussion by its words is a real want
  and a separate index; it is not part of this decision.

## Alternatives rejected

- **A `RelativePosition` pair per thread.** Yjs's own answer to "where was
  this?", encoded as two binary blobs on the thread row. It works, but it puts
  the anchor outside the document, so the *editor* can no longer paint
  highlights without decoding the CRDT for every thread, and the static
  renderer — which must not touch a database — cannot paint them at all.
  Everything the reader shows would have to become client-side.
- **A `comment` node in the document.** An inline atom, like `mention`. But a
  comment covers a *range*, not a point, and a node marking a range means two
  nodes and an invariant that they stay balanced through arbitrary CRDT edits.
  Marks already express ranges.
- **Comment bodies in the page's Y.Doc.** Keeps everything in one place and
  gives comments collaborative editing. It also makes every reply a document
  edit — a revision checkpoint, a projection rebuild, a "last modified by"
  change — and makes "all open threads across the space" an operation that
  loads every Y.Doc in the space.
- **Waiting for V3.** The dependency argument for deferring comments was
  `block_index`, and it was never real: a comment anchors to a page and a
  position in it, not to an indexed node. Nothing in H1 was needed for this,
  and the inbox that H3 built is exactly what a comment notification wants.
