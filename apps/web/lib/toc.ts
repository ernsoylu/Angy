export interface TocItem {
  id: string;
  text: string;
}

function slugifyHeading(text: string): string {
  return (
    text
      .toLowerCase()
      .replace(/<[^>]*>/g, "")
      .replace(/[^a-z0-9\s-]/g, "")
      .trim()
      .replace(/\s+/g, "-") || "section"
  );
}

/** Inject ids into h2 headings of projection HTML and return the TOC. */
export function injectToc(html: string): { html: string; toc: TocItem[] } {
  const toc: TocItem[] = [];
  const seen = new Set<string>();
  const out = html.replace(/<h2([^>]*)>([\s\S]*?)<\/h2>/g, (_m, attrs: string, inner: string) => {
    const text = inner.replace(/<[^>]*>/g, "");
    let id = slugifyHeading(text);
    for (let i = 2; seen.has(id); i++) id = `${slugifyHeading(text)}-${i}`;
    seen.add(id);
    toc.push({ id, text });
    return `<h2${attrs} id="${id}">${inner}</h2>`;
  });
  return { html: out, toc };
}
