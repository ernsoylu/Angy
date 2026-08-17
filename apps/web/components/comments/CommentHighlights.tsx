/**
 * Paints the anchors of *live* comment threads (V2 H5.2, ADR 0014).
 *
 * The static renderer is a pure JSON→HTML function, so `rendered_html` carries
 * every `<mark data-thread-id>` the document has ever had, including anchors
 * whose thread was resolved or deleted. Which of them is live is a database
 * fact, and the reader is the first place that knows it.
 *
 * A rule per live thread is how that fact reaches the page without shipping
 * JavaScript to the read path — the alternative was rewriting the HTML string
 * on every render, which means parsing the article to change an attribute.
 *
 * Ids come from the database as uuids; they are filtered to that shape anyway
 * before being interpolated, because this is a stylesheet built from data.
 */
const UUID = /^[0-9a-f-]{36}$/;

export function CommentHighlights({ threadIds }: { threadIds: string[] }) {
  const live = threadIds.filter((id) => UUID.test(id));
  if (live.length === 0) return null;

  const selectors = live
    .flatMap((id) => [
      `.article-prose mark[data-thread-id="${id}"]`,
      `.tiptap mark[data-thread-id="${id}"]`,
    ])
    .join(",");

  return (
    <style>{`${selectors}{background:var(--comment-highlight);border-bottom:1px solid var(--accent);}`}</style>
  );
}
