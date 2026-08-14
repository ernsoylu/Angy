"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { FileArchive, FileText, Upload } from "lucide-react";
import type { ImportResultDto, SpaceDto } from "@angy/shared";
import { Button } from "../ui/Button";
import { Callout } from "../ui/Callout";
import { useToast } from "../ui/ToastProvider";
import { formatBytes } from "../../lib/time";
import { cx } from "../../lib/cx";
import styles from "./import.module.css";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

/**
 * Import a Notion or Confluence export into this space (V2 H2, ADR 0005).
 *
 * The screen's real job is the *result*, not the upload. An import creates
 * dozens of pages in one action, and the only way it can be trusted is if it
 * says what it made and what it could not place — a file with no home, an
 * image the archive did not contain, media nothing pointed at. Everything the
 * server refuses comes back with a reason, and all of it is shown.
 *
 * One-directional by construction: this writes fresh pages and there is no way
 * back. Markdown carries no CRDT tombstones, so a merge would discard the
 * history collaborative editing depends on.
 */
export function ImportView({ space }: { space: SpaceDto }) {
  const router = useRouter();
  const { toast } = useToast();
  const fileInput = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ImportResultDto | null>(null);

  function choose(chosen: File | undefined) {
    if (!chosen) return;
    if (!/\.zip$/i.test(chosen.name)) {
      toast("error", "That is not an export archive", "Pick the .zip your wiki exported.");
      return;
    }
    setFile(chosen);
    setResult(null);
  }

  async function run() {
    if (!file) return;
    setBusy(true);
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch(`${API_URL}/spaces/${space.id}/import/archive`, {
        method: "POST",
        credentials: "include",
        body: form,
      });
      const body = await res.json();
      if (!body.success) {
        toast("error", "Import failed", body.error.message);
        return;
      }
      const data = body.data as ImportResultDto;
      setResult(data);
      setFile(null);
      toast(
        "success",
        `${data.created.length} page${data.created.length === 1 ? "" : "s"} imported`,
        "The worker is rendering them now — a page may take a moment to read.",
      );
      // The sidebar tree is server-rendered, so it needs a fresh render to
      // show what was just created.
      router.refresh();
    } catch {
      toast("error", "Import failed", "The archive never reached the server.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={styles.wrap}>
      <header>
        <h1 className={styles.title}>Import content</h1>
        <p className={styles.meta}>
          Bring a Notion or Confluence export into {space.name}. Every file becomes a real page —
          its own document, its own history.
        </p>
      </header>

      <section className={styles.card}>
        <div className="t-caption">Export archive</div>
        <button
          type="button"
          className={cx(styles.drop, dragging && styles.dropActive)}
          disabled={busy}
          onClick={() => fileInput.current?.click()}
          onDragOver={(event) => {
            event.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(event) => {
            event.preventDefault();
            setDragging(false);
            choose(event.dataTransfer.files[0]);
          }}
        >
          <FileArchive size={26} style={{ color: "var(--accent)" }} />
          <span className={styles.dropTitle}>
            {file ? file.name : "Drop a .zip here, or choose a file"}
          </span>
          <span className={styles.dropBody}>
            {file
              ? formatBytes(file.size)
              : "Export as Markdown — HTML and PDF exports carry no structure to import."}
          </span>
        </button>
        <input
          ref={fileInput}
          type="file"
          accept=".zip,application/zip"
          hidden
          aria-label="Export archive"
          onChange={(event) => choose(event.target.files?.[0])}
        />

        <div className={styles.actions}>
          <Button icon={<Upload size={14} />} disabled={!file || busy} onClick={() => void run()}>
            {busy ? "Importing…" : "Import into this space"}
          </Button>
          {busy && (
            <span className={styles.hint} role="status">
              Unpacking, creating pages and storing media. Large exports take a minute.
            </span>
          )}
        </div>

        <Callout tone="hardRule" title="Import runs one way">
          Imported pages are new pages, not a link to the source. Editing here never travels back,
          and importing the same archive twice makes a second copy.
        </Callout>
      </section>

      {result && (
        <>
          <section className={styles.card}>
            <div className={styles.sectionHead}>
              <span className="t-caption">Imported</span>
              <span className={styles.count}>
                {result.created.length} page{result.created.length === 1 ? "" : "s"} ·{" "}
                {result.attachments} attachment{result.attachments === 1 ? "" : "s"}
              </span>
            </div>
            <div className={styles.list} data-testid="import-created">
              {result.created.map((page) => (
                <Link key={page.id} href={`/p/${page.id}`} className={styles.row}>
                  <FileText size={15} style={{ color: "var(--text-3)", flexShrink: 0 }} />
                  <span className={styles.rowTitle}>{page.title}</span>
                  <span className={styles.rowPath}>{page.path}</span>
                </Link>
              ))}
            </div>
          </section>

          {result.skipped.length > 0 && (
            <section className={styles.card}>
              <div className={styles.sectionHead}>
                <span className="t-caption">Not imported</span>
                <span className={styles.count}>{result.skipped.length}</span>
              </div>
              <div className={styles.list} data-testid="import-skipped">
                {result.skipped.map((entry, index) => (
                  <div key={`${entry.path}-${index}`} className={styles.row}>
                    <span className={styles.rowTitle}>{entry.path || "The archive"}</span>
                    <span className={styles.rowPath}>{entry.reason}</span>
                  </div>
                ))}
              </div>
            </section>
          )}
        </>
      )}
    </div>
  );
}
