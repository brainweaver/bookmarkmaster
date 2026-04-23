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

  const exportBookmarks = exportFilterTags.length > 0
    ? bookmarks.filter((b) => exportFilterTags.every((t) => b.tags.includes(t)))
    : bookmarks;

  function addTag(tag: string) {
    const trimmed = tag.trim().toLowerCase().replace(/\s+/g, "-");
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
      for (const b of exportBookmarks) {
        await chrome.bookmarks.create({ parentId: "2", title: b.title, url: b.url });
      }
      setPhase({
        kind: "done",
        message: `Exported ${exportBookmarks.length} bookmark${exportBookmarks.length !== 1 ? "s" : ""} to Other Bookmarks.`,
      });
    } catch {
      setPhase({ kind: "error", message: "Could not export to Chrome bookmarks." });
    }
  }
  function handleExportJSON() {
    const payload = backupPayload
      ? {
          version: backupPayload.version,
          bookmarks: exportBookmarks,
          customTags: backupPayload.customTags,
          preferences: backupPayload.preferences,
        }
      : {
          // Fallback shape if backup metadata is not provided by parent.
          version: 2,
          bookmarks: exportBookmarks,
          customTags: [],
          preferences: {},
        };
    triggerDownload(
      "bookmarks.json",
      JSON.stringify(payload, null, 2),
      "application/json"
    );
    setPhase({ kind: "done", message: `Downloaded bookmarks.json (${exportBookmarks.length} bookmarks).` });
  }

  function handleExportToBrowsers() {
    const html = generateHTMLBookmarks(exportBookmarks);
    triggerDownload("bookmarks-browser-compatible.html", html, "text/html");
    setPhase({
      kind: "done",
      message: `Downloaded bookmarks-browser-compatible.html (${exportBookmarks.length} bookmarks).`,
    });
  }

  function handleExportTXT() {
    const text = exportBookmarks.map((b) => b.url).join("\n");
    triggerDownload("bookmarks.txt", text, "text/plain");
    setPhase({ kind: "done", message: `Downloaded bookmarks.txt (${exportBookmarks.length} bookmarks).` });
  }

  function handleExportCopy() {
    const text = exportBookmarks.map((b) => b.url).join("\n");
    navigator.clipboard
      .writeText(text)
      .then(() => setPhase({ kind: "done", message: `Copied ${exportBookmarks.length} URLs to clipboard.` }))
      .catch(() => setPhase({ kind: "error", message: "Could not copy URLs to clipboard." }));
  }

  function triggerDownload(name: string, content: string, type: string) {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([content], { type }));
    a.download = name;
    a.click();
    URL.revokeObjectURL(a.href);
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
        display: "flex", flexDirection: "column", gap: 20,
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
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
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
              icon="⭐"
              label="From Chrome Bookmarks"
              sub="Import directly from this browser"
              onClick={handleImportChrome}
              disabled={isBusy}
            />
            <ActionBtn
              icon="🌐"
              label="From Browser Export"
              sub="Auto-detect from browser export file"
              onClick={() => openImportFilePicker("browser")}
              disabled={isBusy}
            />
            <ActionBtn
              icon="📂"
              label="From File (Json,HTML,or TXT)"
              sub="Auto-detect JSON, HTML, or plain URLs"
              onClick={() => openImportFilePicker("file")}
              disabled={isBusy}
            />
            <ActionBtn
              icon="📋"
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
                      const t = exportTagInput.trim().toLowerCase().replace(/\s+/g, "-");
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
              icon="🔖"
              label="To Chrome Bookmarks"
              sub="Adds to Other Bookmarks"
              onClick={handleExportChrome}
              disabled={isBusy || exportBookmarks.length === 0}
            />
            <ActionBtn
              icon="🌐"
              label="Export To Browsers"
              sub="Browser-compatible bookmarks HTML"
              onClick={handleExportToBrowsers}
              disabled={isBusy || exportBookmarks.length === 0}
            />
            <ActionBtn
              icon="{}"
              label="Download As Json"
              sub="Full data with tags & descriptions"
              onClick={handleExportJSON}
              disabled={isBusy || exportBookmarks.length === 0}
            />
            <ActionBtn
              icon="📄"
              label="Download As Text"
              sub="One URL per line"
              onClick={handleExportTXT}
              disabled={isBusy || exportBookmarks.length === 0}
            />
            <ActionBtn
              icon="⎘"
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
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))", gap: 8 }}>
      {children}
    </div>
  );
}

function ActionBtn({
  icon, label, sub, onClick, disabled,
}: {
  icon: string; label: string; sub: string; onClick: () => void; disabled?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        width: "100%", minWidth: 0,
        display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 4,
        padding: "12px 14px", borderRadius: 10,
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
      <span style={{ fontSize: 18, lineHeight: 1 }}>{icon}</span>
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
