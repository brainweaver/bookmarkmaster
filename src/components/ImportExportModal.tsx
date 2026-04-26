import { useRef, useState, useEffect } from "react";
import type { Bookmark } from "../data/mockBookmarks";
import { tagColor } from "../utils/tagColors";
import {
  chromeNodesToBookmarks,
  flattenChromeBookmarks,
  generateHTMLBookmarks,
  parseHTMLBookmarks,
  rawToBookmarks,
} from "../utils/bookmarkIO";

interface Props {
  bookmarks: Bookmark[];
  onImport: (items: Omit<Bookmark, "id">[]) => void;
  onClose: () => void;
  selectedTag: string | null;
  allTags: string[];
  section?: "import" | "export";
  backupPayload?: {
    version: number;
    customTags: string[];
    preferences: Record<string, unknown>;
  };
}

type Phase =
  | { kind: "idle" }
  | { kind: "preview"; source: string; items: Omit<Bookmark, "id">[]; skipped: number }
  | { kind: "busy"; label: string }
  | { kind: "done"; message: string }
  | { kind: "error"; message: string };

type ParsedRawBookmark = {
  title?: string;
  url: string;
  description?: string;
  tags?: string[];
  favicon?: string;
  addedAt?: string;
};

function normalizeTag(tag: string): string {
  return tag.trim().toLowerCase().replace(/\s+/g, "-");
}

function bookmarkMatchesAllTags(bookmark: Bookmark, tags: string[]): boolean {
  if (tags.length === 0) return true;
  const bookmarkTags = new Set(bookmark.tags.map(normalizeTag));
  return tags.every((tag) => bookmarkTags.has(normalizeTag(tag)));
}

export default function ImportExportModal({ bookmarks, onImport, onClose, selectedTag, allTags, section, backupPayload }: Props) {
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const [importTags, setImportTags] = useState<string[]>(selectedTag ? [selectedTag] : []);
  const [tagInput, setTagInput] = useState("");
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [exportFilterTags, setExportFilterTags] = useState<string[]>(selectedTag ? [selectedTag] : []);
  const [exportTagInput, setExportTagInput] = useState("");
  const [showExportSuggestions, setShowExportSuggestions] = useState(false);
  const [showTextPaste, setShowTextPaste] = useState(false);
  const [pasteText, setPasteText] = useState("");
  const tagInputRef = useRef<HTMLInputElement>(null);
  const exportTagInputRef = useRef<HTMLInputElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [fileImportSource, setFileImportSource] = useState<"browser" | "file">("file");
  const overlayRef = useRef<HTMLDivElement>(null);
  const existingUrls = new Set(bookmarks.map((b) => b.url));

  const tagSuggestions = allTags.filter(
    (t) => t.toLowerCase().includes(tagInput.toLowerCase()) && !importTags.includes(t) && tagInput.length > 0
  );

  const exportTagSuggestions = allTags.filter(
    (t) => t.toLowerCase().includes(exportTagInput.toLowerCase()) && !exportFilterTags.includes(t) && exportTagInput.length > 0
  );

  useEffect(() => {
    if (section !== "export") return;
    setExportFilterTags(selectedTag ? [normalizeTag(selectedTag)] : []);
    setExportTagInput("");
    setShowExportSuggestions(false);
  }, [section, selectedTag]);

  const activeExportFilterTags = exportFilterTags.length > 0
    ? exportFilterTags
    : selectedTag
      ? [selectedTag]
      : [];

  const exportBookmarks = activeExportFilterTags.length > 0
    ? bookmarks.filter((b) => bookmarkMatchesAllTags(b, activeExportFilterTags))
    : bookmarks;

  function addTag(tag: string) {
    const trimmed = normalizeTag(tag);
    if (trimmed && !importTags.includes(trimmed)) setImportTags((p) => [...p, trimmed]);
    setTagInput("");
    setShowSuggestions(false);
  }

  function removeTag(tag: string) {
    setImportTags((p) => p.filter((t) => t !== tag));
  }

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  // ── Import ──────────────────────────────────────────────────────────────────

  function openImportFilePicker(source: "browser" | "file") {
    setFileImportSource(source);
    fileRef.current?.click();
  }

  function parseRawFromInputText(text: string): ParsedRawBookmark[] {
    const fromUnknown = (value: unknown): ParsedRawBookmark | null => {
      if (!value || typeof value !== "object") return null;
      const entry = value as Record<string, unknown>;
      const url = String(entry.url ?? entry.href ?? "").trim();
      if (!url.startsWith("http")) return null;

      const rawTags = entry.tags;
      const tags = Array.isArray(rawTags)
        ? rawTags.map((t) => String(t ?? "").trim()).filter(Boolean)
        : undefined;

      return {
        title: String(entry.title ?? entry.name ?? "").trim() || undefined,
        url,
        description: String(entry.description ?? "").trim() || undefined,
        tags,
        favicon: String(entry.favicon ?? entry.icon ?? "").trim() || undefined,
        addedAt: String(entry.addedAt ?? "").trim() || undefined,
      };
    };

    try {
      const parsed = JSON.parse(text);

      if (parsed && typeof parsed === "object" && Array.isArray((parsed as { bookmarks?: unknown }).bookmarks)) {
        const raw = (parsed as { bookmarks: unknown[] }).bookmarks
          .map((entry) => fromUnknown(entry))
          .filter((v): v is ParsedRawBookmark => v !== null);
        if (raw.length > 0) return raw;
      }

      if (Array.isArray(parsed)) {
        const raw = parsed
          .map((entry) => fromUnknown(entry))
          .filter((v): v is ParsedRawBookmark => v !== null);
        if (raw.length > 0) return raw;
      }
    } catch {
      // Input may not be JSON; continue with HTML/text parsing fallback.
    }

    const htmlRaw = parseHTMLBookmarks(text);
    if (htmlRaw.length > 0) return htmlRaw.map((r) => ({ title: r.title, url: r.url }));

    return text
      .split(/[\n\r,\s]+/)
      .map((s) => s.trim())
      .filter((s) => s.startsWith("http"))
      .map((url): ParsedRawBookmark | null => {
        try {
          return { title: new URL(url).hostname, url };
        } catch {
          return null;
        }
      })
      .filter((v): v is ParsedRawBookmark => v !== null);
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (ev) => {
      const text = String(ev.target?.result ?? "");
      const raw = parseRawFromInputText(text);
      const items = rawToBookmarks(raw, existingUrls);
      const skipped = raw.filter((r) => existingUrls.has(r.url)).length;

      if (items.length === 0 && skipped === 0) {
        setPhase({ kind: "done", message: "No bookmarks found in file." });
      } else {
        setPhase({
          kind: "preview",
          source: fileImportSource === "browser" ? "browser export file" : file.name,
          items,
          skipped,
        });
      }
    };
    reader.readAsText(file);
    setPhase({ kind: "busy", label: "Reading file…" });
  }

  function handleTextImport() {
    const lines = pasteText.split(/[\n\r,\s]+/).map((s) => s.trim()).filter((s) => s.startsWith("http"));
    const raw = lines.map((url) => {
      let hostname = "";
      try { hostname = new URL(url).hostname; } catch { return null; }
      return { title: hostname, url } satisfies ParsedRawBookmark;
    }).filter(Boolean) as ParsedRawBookmark[];
    const items = rawToBookmarks(raw, existingUrls);
    const skipped = raw.filter((r) => existingUrls.has(r.url)).length;
    if (items.length === 0 && skipped === 0) {
      setPhase({ kind: "done", message: "No valid URLs found." });
    } else {
      setPhase({ kind: "preview", source: "pasted text", items, skipped });
    }
    setShowTextPaste(false);
    setPasteText("");
  }

  async function handleImportChrome() {
    setPhase({ kind: "busy", label: "Reading Chrome bookmarks…" });
    try {
      const tree = await chrome.bookmarks.getTree();
      const all = flattenChromeBookmarks(tree);
      const items = chromeNodesToBookmarks(all, existingUrls);
      const skipped = all.filter((n) => !!n.url && existingUrls.has(n.url)).length;

      if (items.length === 0 && skipped === 0) {
        setPhase({ kind: "done", message: "No bookmarks found in Chrome." });
        return;
      }

      setPhase({
        kind: "preview",
        source: "Chrome bookmarks",
        items,
        skipped,
      });
    } catch {
      setPhase({ kind: "error", message: "Could not read Chrome bookmarks." });
    }
  }

  function confirmImport() {
    if (phase.kind !== "preview") return;
    const itemsWithTags = phase.items.map((item) => ({
      ...item,
      tags: Array.from(new Set([...item.tags, ...importTags])),
    }));
    onImport(itemsWithTags);
    setPhase({
      kind: "done",
      message: `Imported ${phase.items.length} bookmark${phase.items.length !== 1 ? "s" : ""}${importTags.length ? ` with tag${importTags.length !== 1 ? "s" : ""}: ${importTags.join(", ")}` : ""}.`,
    });
  }

  // ── Export ──────────────────────────────────────────────────────────────────

  async function handleExportChrome() {
    setPhase({ kind: "busy", label: "Exporting to Chrome bookmarks…" });
    try {
      const exportSnapshot = [...exportBookmarks];
      for (const b of exportSnapshot) {
        await chrome.bookmarks.create({ parentId: "2", title: b.title, url: b.url });
      }
      setPhase({
        kind: "done",
        message: `Exported ${exportSnapshot.length} bookmark${exportSnapshot.length !== 1 ? "s" : ""} to Other Bookmarks.`,
      });
    } catch {
      setPhase({ kind: "error", message: "Could not export to Chrome bookmarks." });
    }
  }
  function handleExportJSON() {
    const exportSnapshot = [...exportBookmarks];
    const payload = backupPayload
      ? {
          version: backupPayload.version,
          bookmarks: exportSnapshot,
          customTags: backupPayload.customTags,
          preferences: backupPayload.preferences,
        }
      : {
          // Fallback shape if backup metadata is not provided by parent.
          version: 2,
          bookmarks: exportSnapshot,
          customTags: [],
          preferences: {},
        };
    triggerDownload(
      "bookmarks.json",
      JSON.stringify(payload, null, 2),
      "application/json"
    );
    setPhase({ kind: "done", message: `Downloaded bookmarks.json (${exportSnapshot.length} bookmarks).` });
  }

  function handleExportToBrowsers() {
    const exportSnapshot = [...exportBookmarks];
    const html = generateHTMLBookmarks(exportSnapshot);
    triggerDownload("bookmarks-browser-compatible.html", html, "text/html");
    setPhase({
      kind: "done",
      message: `Downloaded bookmarks-browser-compatible.html (${exportSnapshot.length} bookmarks).`,
    });
  }

  function handleExportTXT() {
    const exportSnapshot = [...exportBookmarks];
    const text = exportSnapshot.map((b) => b.url).join("\n");
    triggerDownload("bookmarks.txt", text, "text/plain");
    setPhase({ kind: "done", message: `Downloaded bookmarks.txt (${exportSnapshot.length} bookmarks).` });
  }

  function handleExportCopy() {
    const exportSnapshot = [...exportBookmarks];
    const text = exportSnapshot.map((b) => b.url).join("\n");
    navigator.clipboard
      .writeText(text)
      .then(() => setPhase({ kind: "done", message: `Copied ${exportSnapshot.length} URLs to clipboard.` }))
      .catch(() => setPhase({ kind: "error", message: "Could not copy URLs to clipboard." }));
  }

  function triggerDownload(name: string, content: string, type: string) {
    const a = document.createElement("a");
    const blobUrl = URL.createObjectURL(new Blob([content], { type }));
    a.href = blobUrl;
    a.download = name;
    a.style.display = "none";
    document.body.appendChild(a);
    a.click();
    window.setTimeout(() => {
      URL.revokeObjectURL(blobUrl);
      a.remove();
    }, 0);
  }

  // ── Render ──────────────────────────────────────────────────────────────────

  const isBusy = phase.kind === "busy";

  return (
    <div
      ref={overlayRef}
      onClick={(e) => { if (e.target === overlayRef.current) onClose(); }}
      style={{
        position: "fixed", inset: 0,
        background: "rgba(0,0,0,0.6)", backdropFilter: "blur(4px)",
        display: "flex", alignItems: "center", justifyContent: "center",
        zIndex: 1000,
      }}
    >
      <div style={{
        background: "var(--card)", border: "1px solid var(--border-hover)",
        borderRadius: 14, padding: 24, width: 640,
        maxWidth: "calc(100vw - 40px)",
        display: "flex", flexDirection: "column", gap: 24,
        boxShadow: "0 24px 60px rgba(0,0,0,0.6)",
      }}>
        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <h2 style={{ fontSize: 16, fontWeight: 700, color: "var(--text)", margin: 0 }}>
            {section === "import" ? "Import" : section === "export" ? "Export" : "Import / Export"}
          </h2>
          <button onClick={onClose} style={closeBtn}>✕</button>
        </div>

        {/* Status / Preview banner */}
        {phase.kind !== "idle" && (
          <div style={{
            padding: "12px 14px", borderRadius: 10,
            background: phase.kind === "error" ? "#ef444420"
              : phase.kind === "done" ? "#16a34a20"
              : phase.kind === "preview" ? "#3b82f620"
              : "var(--border)",
            border: `1px solid ${
              phase.kind === "error" ? "#ef444440"
              : phase.kind === "done" ? "#16a34a40"
              : phase.kind === "preview" ? "#3b82f640"
              : "var(--border-hover)"}`,
            display: "flex", flexDirection: "column", gap: 10,
          }}>
            {phase.kind === "busy" && (
              <span style={{ fontSize: 13, color: "var(--text-2)" }}>
                <Spinner /> {phase.label}
              </span>
            )}
            {phase.kind === "error" && (
              <span style={{ fontSize: 13, color: "#ef4444" }}>{phase.message}</span>
            )}
            {phase.kind === "done" && (
              <span style={{ fontSize: 13, color: "#4ade80" }}>{phase.message}</span>
            )}
            {phase.kind === "preview" && (
              <>
                <div style={{ fontSize: 13, color: "var(--text)" }}>
                  <strong style={{ color: "#60a5fa" }}>{phase.items.length} new bookmark{phase.items.length !== 1 ? "s" : ""}</strong>
                  {" "}found in <em style={{ color: "var(--text-2)" }}>{phase.source}</em>
                  {phase.skipped > 0 && (
                    <span style={{ color: "var(--text-3)" }}>
                      {" "}· {phase.skipped} already exist{phase.skipped !== 1 ? "" : "s"}, skipped
                    </span>
                  )}
                </div>
                {phase.items.length > 0 && (
                  <div style={{ maxHeight: 120, overflowY: "auto", display: "flex", flexDirection: "column", gap: 4 }}>
                    {phase.items.slice(0, 8).map((b) => (
                      <div key={b.url} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: "var(--text-2)" }}>
                        <img src={b.favicon} width={12} height={12} style={{ borderRadius: 2, flexShrink: 0 }}
                          onError={(e) => { (e.target as HTMLImageElement).style.visibility = "hidden"; }} />
                        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{b.title}</span>
                        <span style={{ color: "var(--text-4)", flexShrink: 0, marginLeft: "auto", fontSize: 11 }}>
                          {new URL(b.url).hostname}
                        </span>
                      </div>
                    ))}
                    {phase.items.length > 8 && (
                      <span style={{ fontSize: 11, color: "var(--text-4)" }}>
                        + {phase.items.length - 8} more
                      </span>
                    )}
                  </div>
                )}
                <div style={{ display: "flex", gap: 8 }}>
                  <button onClick={() => setPhase({ kind: "idle" })} style={secondaryBtn}>
                    Cancel
                  </button>
                  {phase.items.length > 0 && (
                    <button onClick={confirmImport} style={primaryBtn}>
                      Import {phase.items.length} bookmark{phase.items.length !== 1 ? "s" : ""}
                    </button>
                  )}
                </div>
              </>
            )}
          </div>
        )}

        {/* Import section */}{section !== "export" && <>
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {/* Header row: IMPORT label on left, Import Tags label + pill input on right */}
          <div style={{ display: "flex", alignItems: "center" }}>
            <span style={{ fontSize: 11, fontWeight: 700, color: "var(--text-4)", letterSpacing: "0.07em", textTransform: "uppercase" }}>
              Import
            </span>
            <div style={{ flex: 1 }} />
            <span style={{ fontSize: 11, fontWeight: 600, color: "var(--text-3)", marginRight: 8, whiteSpace: "nowrap" }}>
              Import Tags:
            </span>
            <div style={{ position: "relative", width: 208 }}>
              <div
                onClick={() => tagInputRef.current?.focus()}
                style={{
                  display: "flex", flexWrap: "wrap", gap: 4, alignItems: "center",
                  padding: "3px 8px", background: "var(--bg)",
                  border: "1px solid var(--border-hover)", borderRadius: 7,
                  cursor: "text", minHeight: 26,
                }}
              >
                {importTags.map((tag) => (
                  <span key={tag} style={{
                    display: "flex", alignItems: "center", gap: 3,
                    fontSize: 11, padding: "1px 6px", borderRadius: 99,
                    background: tagColor(tag) + "22", color: tagColor(tag),
                    border: `1px solid ${tagColor(tag)}44`,
                  }}>
                    {tag}
                    <span onClick={() => removeTag(tag)} style={{ cursor: "pointer", opacity: 0.7, fontSize: 10 }}>✕</span>
                  </span>
                ))}
                <input
                  ref={tagInputRef}
                  type="text"
                  value={tagInput}
                  placeholder={importTags.length === 0 ? "Add tag…" : ""}
                  onChange={(e) => { setTagInput(e.target.value); setShowSuggestions(true); }}
                  onKeyDown={(e) => {
                    if ((e.key === "Enter" || e.key === ",") && tagInput.trim()) { e.preventDefault(); addTag(tagInput); }
                    if (e.key === "Backspace" && !tagInput && importTags.length) removeTag(importTags[importTags.length - 1]);
                    if (e.key === "Escape") setShowSuggestions(false);
                  }}
                  onFocus={() => setShowSuggestions(true)}
                  onBlur={() => setTimeout(() => setShowSuggestions(false), 150)}
                  style={{ background: "none", border: "none", outline: "none", color: "var(--text)", fontSize: 12, flex: 1, minWidth: 50 }}
                />
              </div>
              {showSuggestions && tagSuggestions.length > 0 && (
                <div style={{
                  position: "absolute", top: "calc(100% + 4px)", left: 0, right: 0,
                  background: "var(--surface)", border: "1px solid var(--border-hover)",
                  borderRadius: 8, overflow: "hidden", zIndex: 10,
                  boxShadow: "0 8px 24px rgba(0,0,0,0.4)",
                }}>
                  {tagSuggestions.map((s) => (
                    <button key={s} onMouseDown={() => addTag(s)} style={{
                      display: "flex", alignItems: "center", gap: 8, width: "100%",
                      padding: "7px 12px", background: "none", border: "none",
                      color: "var(--text)", fontSize: 12, cursor: "pointer", textAlign: "left",
                    }}>
                      <span style={{ width: 8, height: 8, borderRadius: "50%", background: tagColor(s), flexShrink: 0 }} />
                      {s}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          <Row>
            <ActionBtn
              icon={
                <svg width="32" height="32" viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
                  <rect width="48" height="48" rx="24" fill="#FEE4E2" />
                  <path d="M17.6 11.2C15.835 11.2 14.4 12.635 14.4 14.4V35.1999C14.4 35.7749 14.71 36.3099 15.21 36.5899C15.71 36.8699 16.325 36.865 16.82 36.57L24 32.2649L31.175 36.57C31.67 36.865 32.285 36.8749 32.785 36.5899C33.285 36.3049 33.6 35.7749 33.6 35.1999V14.4C33.6 12.635 32.165 11.2 30.4 11.2H17.6Z" fill="#F04438" />
                </svg>
              }
              label="From Chrome Bookmarks"
              sub="Import directly from this browser"
              onClick={handleImportChrome}
              disabled={isBusy}
            />
            <ActionBtn
              icon={
                <svg width="32" height="32" viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
                  <rect width="48" height="48" rx="24" fill="#E0F2FE" />
                  <path d="M28.795 25.2H19.25C19.395 28.425 20.11 31.395 21.125 33.57C21.695 34.795 22.31 35.66 22.88 36.19C23.44 36.715 23.825 36.8 24.025 36.8C24.225 36.8 24.61 36.715 25.17 36.19C25.74 35.66 26.355 34.79 26.925 33.57C27.94 31.395 28.655 28.425 28.8 25.2H28.795ZM19.245 22.8H28.79C28.65 19.575 27.935 16.605 26.92 14.43C26.35 13.21 25.735 12.34 25.165 11.81C24.605 11.285 24.22 11.2 24.02 11.2C23.82 11.2 23.435 11.285 22.875 11.81C22.305 12.34 21.69 13.21 21.12 14.43C20.105 16.605 19.39 19.575 19.245 22.8ZM16.845 22.8C17.02 18.52 18.125 14.545 19.74 11.935C15.135 13.565 11.745 17.76 11.275 22.8H16.845ZM11.275 25.2C11.745 30.24 15.135 34.435 19.74 36.065C18.125 33.455 17.02 29.48 16.845 25.2H11.275ZM31.195 25.2C31.02 29.48 29.915 33.455 28.3 36.065C32.905 34.43 36.295 30.24 36.765 25.2H31.195ZM36.765 22.8C36.295 17.76 32.905 13.565 28.3 11.935C29.915 14.545 31.02 18.52 31.195 22.8H36.765Z" fill="#0BA5EC" />
                </svg>
              }
              label="From Browser Export"
              sub="Auto-detect from browser export file"
              onClick={() => openImportFilePicker("browser")}
              disabled={isBusy}
            />
            <ActionBtn
              icon={
                <svg width="32" height="32" viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
                  <rect width="48" height="48" rx="24" fill="#FDEAD7" />
                  <path d="M14.4 14.4C14.4 12.635 15.835 11.2 17.6 11.2H25.075C25.925 11.2 26.74 11.535 27.34 12.135L32.665 17.465C33.265 18.065 33.6 18.88 33.6 19.73V33.6C33.6 35.365 32.165 36.8 30.4 36.8H17.6C15.835 36.8 14.4 35.365 14.4 33.6V14.4ZM24.8 14.125V18.8C24.8 19.465 25.335 20 26 20H30.675L24.8 14.125ZM22.11 25.98C22.54 25.475 22.485 24.72 21.98 24.29C21.475 23.86 20.72 23.915 20.29 24.42L17.89 27.22C17.505 27.67 17.505 28.33 17.89 28.78L20.29 31.58C20.72 32.085 21.48 32.14 21.98 31.71C22.48 31.28 22.54 30.52 22.11 30.02L20.38 28L22.11 25.98ZM27.71 24.42C27.28 23.915 26.52 23.86 26.02 24.29C25.52 24.72 25.46 25.48 25.89 25.98L27.62 28L25.89 30.02C25.46 30.525 25.515 31.28 26.02 31.71C26.525 32.14 27.28 32.085 27.71 31.58L30.11 28.78C30.495 28.33 30.495 27.67 30.11 27.22L27.71 24.42Z" fill="#F79009" />
                </svg>
              }
              label="From File (Json,HTML,or TXT)"
              sub="Auto-detect JSON, HTML, or plain URLs"
              onClick={() => openImportFilePicker("file")}
              disabled={isBusy}
            />
            <ActionBtn
              icon={
                <svg width="32" height="32" viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
                  <rect width="48" height="48" rx="24" fill="#DCFAE6" />
                  <path d="M22.4 11.2C20.635 11.2 19.2 12.635 19.2 14.4V27.2C19.2 28.965 20.635 30.4 22.4 30.4H32C33.765 30.4 35.2 28.965 35.2 27.2V17.17C35.2 16.3 34.845 15.465 34.215 14.86L31.33 12.09C30.735 11.52 29.94 11.2 29.115 11.2H22.4ZM16 17.6C14.235 17.6 12.8 19.035 12.8 20.8V33.6C12.8 35.365 14.235 36.8 16 36.8H25.6C27.365 36.8 28.8 35.365 28.8 33.6V32.8H25.6V33.6H16V20.8H16.8V17.6H16Z" fill="#17B26A" />
                </svg>
              }
              label="From Clipboard"
              sub="Paste URLs, one per line"
              onClick={() => setShowTextPaste((v) => !v)}
              disabled={isBusy}
            />
          </Row>

          {showTextPaste && (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <textarea
                autoFocus
                value={pasteText}
                onChange={(e) => setPasteText(e.target.value)}
                placeholder={"Paste URLs here, one per line:\nhttps://example.com\nhttps://another.com"}
                rows={5}
                style={{
                  width: "100%", boxSizing: "border-box",
                  background: "var(--bg)", border: "1px solid var(--border-hover)",
                  borderRadius: 8, padding: "8px 10px",
                  color: "var(--text)", fontSize: 12, fontFamily: "monospace",
                  resize: "vertical", outline: "none",
                }}
              />
              <div style={{ display: "flex", gap: 8 }}>
                <button onClick={() => { setShowTextPaste(false); setPasteText(""); }} style={secondaryBtn}>
                  Cancel
                </button>
                <button onClick={handleTextImport} disabled={!pasteText.trim()} style={{ ...primaryBtn, opacity: pasteText.trim() ? 1 : 0.5 }}>
                  Preview
                </button>
              </div>
            </div>
          )}

          <input
            ref={fileRef}
            type="file"
            accept={fileImportSource === "browser" ? ".html,.json,.txt" : ".json,.txt"}
            style={{ display: "none" }}
            onChange={handleFileChange}
          />
        </div>

        </>}

        {section == null && <div style={{ height: 1, background: "var(--border)" }} />}

        {/* Export section */}{section !== "import" && <>
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {/* Header row: EXPORT label + count on left, Filter Tags on right */}
          <div style={{ display: "flex", alignItems: "center" }}>
            <span style={{ fontSize: 11, fontWeight: 700, color: "var(--text-4)", letterSpacing: "0.07em", textTransform: "uppercase" }}>
              {`Export  ·  ${exportBookmarks.length}${exportFilterTags.length ? `/${bookmarks.length}` : ""} bookmark${exportBookmarks.length !== 1 ? "s" : ""}`}
            </span>
            <div style={{ flex: 1 }} />
            <span style={{ fontSize: 11, fontWeight: 600, color: "var(--text-3)", marginRight: 8, whiteSpace: "nowrap" }}>
              Filter Tags:
            </span>
            <div style={{ position: "relative", width: 208 }}>
              <div
                onClick={() => exportTagInputRef.current?.focus()}
                style={{
                  display: "flex", flexWrap: "wrap", gap: 4, alignItems: "center",
                  padding: "3px 8px", background: "var(--bg)",
                  border: "1px solid var(--border-hover)", borderRadius: 7,
                  cursor: "text", minHeight: 26,
                }}
              >
                {exportFilterTags.map((tag) => (
                  <span key={tag} style={{
                    display: "flex", alignItems: "center", gap: 3,
                    fontSize: 11, padding: "1px 6px", borderRadius: 99,
                    background: tagColor(tag) + "22", color: tagColor(tag),
                    border: `1px solid ${tagColor(tag)}44`,
                  }}>
                    {tag}
                    <span onClick={() => setExportFilterTags((p) => p.filter((t) => t !== tag))} style={{ cursor: "pointer", opacity: 0.7, fontSize: 10 }}>✕</span>
                  </span>
                ))}
                <input
                  ref={exportTagInputRef}
                  type="text"
                  value={exportTagInput}
                  placeholder={exportFilterTags.length === 0 ? "All tags…" : ""}
                  onChange={(e) => { setExportTagInput(e.target.value); setShowExportSuggestions(true); }}
                  onKeyDown={(e) => {
                    if ((e.key === "Enter" || e.key === ",") && exportTagInput.trim()) {
                      e.preventDefault();
                      const t = normalizeTag(exportTagInput);
                      if (t && !exportFilterTags.includes(t)) setExportFilterTags((p) => [...p, t]);
                      setExportTagInput(""); setShowExportSuggestions(false);
                    }
                    if (e.key === "Backspace" && !exportTagInput && exportFilterTags.length)
                      setExportFilterTags((p) => p.slice(0, -1));
                    if (e.key === "Escape") setShowExportSuggestions(false);
                  }}
                  onFocus={() => setShowExportSuggestions(true)}
                  onBlur={() => setTimeout(() => setShowExportSuggestions(false), 150)}
                  style={{ background: "none", border: "none", outline: "none", color: "var(--text)", fontSize: 12, flex: 1, minWidth: 50 }}
                />
              </div>
              {showExportSuggestions && exportTagSuggestions.length > 0 && (
                <div style={{
                  position: "absolute", top: "calc(100% + 4px)", left: 0, right: 0,
                  background: "var(--surface)", border: "1px solid var(--border-hover)",
                  borderRadius: 8, overflow: "hidden", zIndex: 10,
                  boxShadow: "0 8px 24px rgba(0,0,0,0.4)",
                }}>
                  {exportTagSuggestions.map((s) => (
                    <button key={s} onMouseDown={() => {
                      if (!exportFilterTags.includes(s)) setExportFilterTags((p) => [...p, s]);
                      setExportTagInput(""); setShowExportSuggestions(false);
                    }} style={{
                      display: "flex", alignItems: "center", gap: 8, width: "100%",
                      padding: "7px 12px", background: "none", border: "none",
                      color: "var(--text)", fontSize: 12, cursor: "pointer", textAlign: "left",
                    }}>
                      <span style={{ width: 8, height: 8, borderRadius: "50%", background: tagColor(s), flexShrink: 0 }} />
                      {s}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
          <Row>
            <ActionBtn
              icon={
                <svg width="32" height="32" viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
                  <rect width="48" height="48" rx="24" fill="#FEE4E2" />
                  <path d="M17.6 11.2C15.835 11.2 14.4 12.635 14.4 14.4V35.1999C14.4 35.7749 14.71 36.3099 15.21 36.5899C15.71 36.8699 16.325 36.865 16.82 36.57L24 32.2649L31.175 36.57C31.67 36.865 32.285 36.8749 32.785 36.5899C33.285 36.3049 33.6 35.7749 33.6 35.1999V14.4C33.6 12.635 32.165 11.2 30.4 11.2H17.6Z" fill="#F04438" />
                </svg>
              }
              label="To Chrome Bookmarks"
              sub="Adds to Other Bookmarks"
              onClick={handleExportChrome}
              disabled={isBusy || exportBookmarks.length === 0}
            />
            <ActionBtn
              icon={
                <svg width="32" height="32" viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
                  <rect width="48" height="48" rx="24" fill="#E0F2FE" />
                  <path d="M28.795 25.2H19.25C19.395 28.425 20.11 31.395 21.125 33.57C21.695 34.795 22.31 35.66 22.88 36.19C23.44 36.715 23.825 36.8 24.025 36.8C24.225 36.8 24.61 36.715 25.17 36.19C25.74 35.66 26.355 34.79 26.925 33.57C27.94 31.395 28.655 28.425 28.8 25.2H28.795ZM19.245 22.8H28.79C28.65 19.575 27.935 16.605 26.92 14.43C26.35 13.21 25.735 12.34 25.165 11.81C24.605 11.285 24.22 11.2 24.02 11.2C23.82 11.2 23.435 11.285 22.875 11.81C22.305 12.34 21.69 13.21 21.12 14.43C20.105 16.605 19.39 19.575 19.245 22.8ZM16.845 22.8C17.02 18.52 18.125 14.545 19.74 11.935C15.135 13.565 11.745 17.76 11.275 22.8H16.845ZM11.275 25.2C11.745 30.24 15.135 34.435 19.74 36.065C18.125 33.455 17.02 29.48 16.845 25.2H11.275ZM31.195 25.2C31.02 29.48 29.915 33.455 28.3 36.065C32.905 34.43 36.295 30.24 36.765 25.2H31.195ZM36.765 22.8C36.295 17.76 32.905 13.565 28.3 11.935C29.915 14.545 31.02 18.52 31.195 22.8H36.765Z" fill="#0BA5EC" />
                </svg>
              }
              label="Export To Browsers"
              sub="Browser-compatible bookmarks HTML"
              onClick={handleExportToBrowsers}
              disabled={isBusy || exportBookmarks.length === 0}
            />
            <ActionBtn
              icon={
                <svg width="32" height="32" viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
                  <rect width="48" height="48" rx="24" fill="#ECE9FE" />
                  <path d="M14.4 14.4C14.4 12.635 15.835 11.2 17.6 11.2H25.075C25.925 11.2 26.74 11.535 27.34 12.135L32.665 17.465C33.265 18.065 33.6 18.88 33.6 19.73V33.6C33.6 35.365 32.165 36.8 30.4 36.8H17.6C15.835 36.8 14.4 35.365 14.4 33.6V14.4ZM24.8 14.125V18.8C24.8 19.465 25.335 20 26 20H30.675L24.8 14.125ZM23.15 33.25C23.62 33.72 24.38 33.72 24.845 33.25L28.045 30.05C28.515 29.58 28.515 28.82 28.045 28.355C27.575 27.89 26.815 27.885 26.35 28.355L25.2 29.505V25.2C25.2 24.535 24.665 24 24 24C23.335 24 22.8 24.535 22.8 25.2V29.505L21.65 28.355C21.18 27.885 20.42 27.885 19.955 28.355C19.49 28.825 19.485 29.585 19.955 30.05L23.155 33.25H23.15Z" fill="#875BF7" />
                </svg>
              }
              label="Download As Json"
              sub="Full data with tags & descriptions"
              onClick={handleExportJSON}
              disabled={isBusy || exportBookmarks.length === 0}
            />
            <ActionBtn
              icon={
                <svg width="32" height="32" viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
                  <rect width="48" height="48" rx="24" fill="#FDEAD7" />
                  <path d="M14.4 14.4C14.4 12.635 15.835 11.2 17.6 11.2H25.075C25.925 11.2 26.74 11.535 27.34 12.135L32.665 17.465C33.265 18.065 33.6 18.88 33.6 19.73V33.6C33.6 35.365 32.165 36.8 30.4 36.8H17.6C15.835 36.8 14.4 35.365 14.4 33.6V14.4ZM24.8 14.125V18.8C24.8 19.465 25.335 20 26 20H30.675L24.8 14.125ZM22.11 25.98C22.54 25.475 22.485 24.72 21.98 24.29C21.475 23.86 20.72 23.915 20.29 24.42L17.89 27.22C17.505 27.67 17.505 28.33 17.89 28.78L20.29 31.58C20.72 32.085 21.48 32.14 21.98 31.71C22.48 31.28 22.54 30.52 22.11 30.02L20.38 28L22.11 25.98ZM27.71 24.42C27.28 23.915 26.52 23.86 26.02 24.29C25.52 24.72 25.46 25.48 25.89 25.98L27.62 28L25.89 30.02C25.46 30.525 25.515 31.28 26.02 31.71C26.525 32.14 27.28 32.085 27.71 31.58L30.11 28.78C30.495 28.33 30.495 27.67 30.11 27.22L27.71 24.42Z" fill="#F79009" />
                </svg>
              }
              label="Download As Text"
              sub="One URL per line"
              onClick={handleExportTXT}
              disabled={isBusy || exportBookmarks.length === 0}
            />
            <ActionBtn
              icon={
                <svg width="32" height="32" viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
                  <rect width="48" height="48" rx="24" fill="#DCFAE6" />
                  <path d="M22.4 11.2C20.635 11.2 19.2 12.635 19.2 14.4V27.2C19.2 28.965 20.635 30.4 22.4 30.4H32C33.765 30.4 35.2 28.965 35.2 27.2V17.17C35.2 16.3 34.845 15.465 34.215 14.86L31.33 12.09C30.735 11.52 29.94 11.2 29.115 11.2H22.4ZM16 17.6C14.235 17.6 12.8 19.035 12.8 20.8V33.6C12.8 35.365 14.235 36.8 16 36.8H25.6C27.365 36.8 28.8 35.365 28.8 33.6V32.8H25.6V33.6H16V20.8H16.8V17.6H16Z" fill="#17B26A" />
                </svg>
              }
              label="Copy to Clipboard"
              sub="Copy URLs to clipboard"
              onClick={handleExportCopy}
              disabled={isBusy || exportBookmarks.length === 0}
            />
          </Row>
        </div>
        </>}
      </div>
    </div>
  );
}

// ── Small components ──────────────────────────────────────────────────────────


function Row({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))", gap: 10 }}>
      {children}
    </div>
  );
}

function ActionBtn({
  icon, label, sub, onClick, disabled,
}: {
  icon: React.ReactNode; label: string; sub: string; onClick: () => void; disabled?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        width: "100%", minWidth: 0,
        display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 6,
        padding: "14px 14px", borderRadius: 10,
        background: "var(--surface)", border: "1px solid var(--border-hover)",
        color: "var(--text)", cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.5 : 1,
        textAlign: "left", transition: "border-color 0.1s, background 0.1s",
      }}
      onMouseEnter={(e) => {
        if (!disabled) (e.currentTarget as HTMLElement).style.borderColor = "#3b82f6";
      }}
      onMouseLeave={(e) => {
        (e.currentTarget as HTMLElement).style.borderColor = "var(--border-hover)";
      }}
    >
      <span style={{ width: 32, height: 32, lineHeight: 1, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>{icon}</span>
      <span style={{ fontSize: 13, fontWeight: 600 }}>{label}</span>
      <span style={{ fontSize: 11, color: "var(--text-3)" }}>{sub}</span>
    </button>
  );
}

function Spinner() {
  return (
    <span style={{
      display: "inline-block", width: 10, height: 10, marginRight: 6,
      border: "2px solid var(--border-hover)", borderTopColor: "#3b82f6",
      borderRadius: "50%", animation: "spin 0.7s linear infinite",
      verticalAlign: "middle",
    }} />
  );
}

const primaryBtn: React.CSSProperties = {
  background: "#3b82f6", border: "none", borderRadius: 8,
  padding: "7px 16px", color: "#fff", fontSize: 13, fontWeight: 600, cursor: "pointer",
};

const secondaryBtn: React.CSSProperties = {
  background: "var(--border)", border: "1px solid var(--border-hover)",
  borderRadius: 8, padding: "7px 14px", color: "var(--text-2)", fontSize: 13, cursor: "pointer",
};

const closeBtn: React.CSSProperties = {
  background: "none", border: "none", color: "var(--text-3)",
  fontSize: 18, cursor: "pointer", lineHeight: 1, padding: 2,
};
