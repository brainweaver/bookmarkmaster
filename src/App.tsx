import { useState, useMemo, useEffect, useRef } from "react";
import BookmarkCard from "./components/BookmarkCard";
import TimelineView from "./components/TimelineView";
import ListView from "./components/ListView";
import BookmarkModal from "./components/BookmarkModal";
import ImportExportModal from "./components/ImportExportModal";
import { tagColor } from "./components/BookmarkCard";
import { useBookmarks } from "./hooks/useBookmarks";
import { fetchMeta, isReachable } from "./utils/fetchMeta";
import { localDateKey } from "./utils/date";
import { SYSTEM_TAG_NOT_REACHABLE, visibleTags } from "./constants/tags";
import type { Bookmark } from "./data/mockBookmarks";

function gridColumnsFromZoom(zoom: number): number {
  const normalized = (Math.max(1, Math.min(5, zoom)) - 1) / 4;
  return Math.max(2, Math.min(8, Math.round(8 - normalized * 6)));
}
const NOT_TAGGED_FILTER = "__not_tagged__";
const NOT_REACHABLE_FILTER = SYSTEM_TAG_NOT_REACHABLE;
const BOOKMARK_DRAG_MIME = "application/x-bookmark-id";
const BOOKMARK_DRAG_FALLBACK_PREFIX = "bookmark:";
const TAG_DRAG_MIME = "application/x-sidebar-tag";
const TAG_ORDER_KEY = "ui_tag_order_v1";

type DisplayMode = "list" | "grid" | "preview";
type ModalState =
  | { mode: "closed" }
  | { mode: "add"; prefill?: { url: string; title: string; favicon: string; description?: string } }
  | { mode: "edit"; bookmark: Bookmark };

const PREF_THEME_KEY = "ui_theme_v1";
const PREF_DISPLAY_MODE_KEY = "ui_display_mode_v1";
const PREF_GROUP_BY_DATE_KEY = "ui_group_by_date_v1";
const PREF_SORT_BY_KEY = "ui_sort_by_v1";
const PREF_ZOOM_KEY = "ui_zoom_v1";

function normaliseUrlForDedupe(rawUrl: string): string {
  try {
    const u = new URL(rawUrl);
    const hostname = u.hostname.toLowerCase().replace(/^www\./, "");
    const port =
      u.port &&
      !(
        (u.protocol === "http:" && u.port === "80") ||
        (u.protocol === "https:" && u.port === "443")
      )
        ? `:${u.port}`
        : "";
    const path = u.pathname.replace(/\/+$/, "") || "/";
    return `${hostname}${port}${path}${u.search}`;
  } catch {
    return rawUrl
      .trim()
      .toLowerCase()
      .replace(/^https?:\/\//, "")
      .replace(/^www\./, "")
      .replace(/\/+$/, "");
  }
}

function preferCanonicalUrl(a: string, b: string): string {
  if (a.startsWith("https://")) return a;
  if (b.startsWith("https://")) return b;
  return a;
}

function loadTheme(): "dark" | "light" {
  try {
    const raw = localStorage.getItem(PREF_THEME_KEY);
    return raw === "dark" || raw === "light" ? raw : "light";
  } catch {
    return "light";
  }
}

function loadDisplayMode(): DisplayMode {
  try {
    const raw = localStorage.getItem(PREF_DISPLAY_MODE_KEY);
    return raw === "grid" || raw === "list" || raw === "preview" ? raw : "list";
  } catch {
    return "list";
  }
}

function loadGroupByDate(): boolean {
  try {
    const raw = localStorage.getItem(PREF_GROUP_BY_DATE_KEY);
    if (raw === null) return true;
    return raw === "true";
  } catch {
    return true;
  }
}

function loadSortBy(): "date" | "name" | "ranking" {
  try {
    const raw = localStorage.getItem(PREF_SORT_BY_KEY);
    return raw === "date" || raw === "name" || raw === "ranking" ? raw : "date";
  } catch {
    return "date";
  }
}

function loadZoom(): number {
  try {
    const raw = localStorage.getItem(PREF_ZOOM_KEY);
    const parsed = Number(raw);
    if (!Number.isFinite(parsed)) return 3;
    return Math.max(1, Math.min(5, parsed));
  } catch {
    return 3;
  }
}

function loadTagOrder(): string[] {
  try {
    const raw = localStorage.getItem(TAG_ORDER_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

export default function App() {
  const { bookmarks, addBookmark, updateBookmark, removeBookmark, importBookmarks, renameTag, deleteTag, addTag, replaceBookmarks, allTags } = useBookmarks();
  const [showImport, setShowImport] = useState(false);
  const [showExport, setShowExport] = useState(false);

  const [theme, setTheme] = useState<"dark" | "light">(loadTheme);
  const [displayMode, setDisplayMode] = useState<DisplayMode>(loadDisplayMode);
  const [groupByDate, setGroupByDate] = useState(loadGroupByDate);
  const [zoom, setZoom] = useState(loadZoom);

  const [selectedTag, setSelectedTag] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [sortBy, setSortBy] = useState<"date" | "name" | "ranking">(loadSortBy);
  const [modal, setModal] = useState<ModalState>({ mode: "closed" });
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [newTagInput, setNewTagInput] = useState<string | null>(null);
  const newTagRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [dropLoading, setDropLoading] = useState(false);
  const [cleanupState, setCleanupState] = useState<{ running: boolean; progress: number; total: number }>({ running: false, progress: 0, total: 0 });
  const [cleanupResult, setCleanupResult] = useState<{ removed: number; missing: number; enriched: number; skipped: number } | null>(null);
  const [showDataMenu, setShowDataMenu] = useState(false);
  const dataMenuRef = useRef<HTMLDivElement>(null);
  const restoreFileRef = useRef<HTMLInputElement>(null);
  const [showDeleteAll, setShowDeleteAll] = useState(false);
  const [pendingTagDelete, setPendingTagDelete] = useState<string | null>(null);
  const [tagOrder, setTagOrder] = useState<string[]>(loadTagOrder);

  // When opened via extension toolbar click or context menu, URL params carry
  // the originating tab's info — auto-open the add modal with it prefilled.
  const [incomingTab, setIncomingTab] = useState<{ url: string; title: string; favicon: string } | null>(null);
  const effectiveSelectedTag =
    selectedTag === NOT_TAGGED_FILTER || selectedTag === NOT_REACHABLE_FILTER
      ? null
      : selectedTag;
  const orderedSidebarTags = useMemo(() => {
    const orderedExisting = tagOrder.filter((t) => allTags.includes(t));
    const remaining = allTags.filter((t) => !orderedExisting.includes(t));
    return [...orderedExisting, ...remaining];
  }, [allTags, tagOrder]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const from = params.get("from");
    if (!from) return;
    const tab = {
      url: from,
      title: params.get("title") ?? "",
      favicon: params.get("favicon") ?? "",
    };
    setIncomingTab(tab);
    setModal({ mode: "add", prefill: tab });
    // Clean the URL so a refresh doesn't re-trigger
    window.history.replaceState({}, "", window.location.pathname);
  }, []);

  useEffect(() => {
    if (!showDataMenu) return;
    const handler = (e: MouseEvent) => {
      if (dataMenuRef.current && !dataMenuRef.current.contains(e.target as Node)) {
        setShowDataMenu(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [showDataMenu]);

  useEffect(() => {
    localStorage.setItem(PREF_THEME_KEY, theme);
  }, [theme]);

  useEffect(() => {
    localStorage.setItem(PREF_DISPLAY_MODE_KEY, displayMode);
  }, [displayMode]);

  useEffect(() => {
    localStorage.setItem(PREF_GROUP_BY_DATE_KEY, String(groupByDate));
  }, [groupByDate]);

  useEffect(() => {
    localStorage.setItem(PREF_SORT_BY_KEY, sortBy);
  }, [sortBy]);

  useEffect(() => {
    localStorage.setItem(PREF_ZOOM_KEY, String(zoom));
  }, [zoom]);

  useEffect(() => {
    localStorage.setItem(TAG_ORDER_KEY, JSON.stringify(tagOrder));
  }, [tagOrder]);

  useEffect(() => {
    setTagOrder((prev) => {
      const next = prev.filter((t) => allTags.includes(t));
      return next.length === prev.length ? prev : next;
    });
  }, [allTags]);

  const filtered = useMemo(() => {
    const tokens = search.trim().toLowerCase().split(/\s+/).filter(Boolean);
    const tagTokens = tokens.filter((t) => t.startsWith("#")).map((t) => t.slice(1));
    const textTokens = tokens.filter((t) => !t.startsWith("#"));

    return bookmarks.filter((b) => {
      const userTags = visibleTags(b.tags);
      if (selectedTag === NOT_TAGGED_FILTER && userTags.length > 0) return false;
      if (selectedTag === NOT_REACHABLE_FILTER && !b.tags.includes(SYSTEM_TAG_NOT_REACHABLE)) return false;
      if (effectiveSelectedTag && !b.tags.includes(effectiveSelectedTag)) return false;
      if (tagTokens.some((tag) => !userTags.includes(tag))) return false;
      if (textTokens.some((q) =>
        !b.title.toLowerCase().includes(q) &&
        !(b.description?.toLowerCase().includes(q)) &&
        !b.url.toLowerCase().includes(q) &&
        !userTags.some((t) => t.includes(q))
      )) return false;
      return true;
    });
  }, [bookmarks, selectedTag, effectiveSelectedTag, search]);

  const sorted = useMemo(() => {
    const arr = [...filtered];
    if (sortBy === "name") arr.sort((a, b) => a.title.localeCompare(b.title));
    else if (sortBy === "ranking") arr.sort((a, b) => (b.ranking ?? 0) - (a.ranking ?? 0));
    else arr.sort((a, b) => b.addedAt.localeCompare(a.addedAt));
    return arr;
  }, [filtered, sortBy]);

  // Date grouping only makes sense when sorted by date
  const effectiveGroupByDate = groupByDate && sortBy === "date";

  const handleSave = (data: Omit<Bookmark, "id" | "addedAt">) => {
    if (modal.mode === "add") addBookmark(data);
    else if (modal.mode === "edit") updateBookmark(modal.bookmark.id, data);
    setModal({ mode: "closed" });
  };

  const handleDelete = (id: string) => {
    if (deleteConfirm === id) {
      removeBookmark(id);
      setDeleteConfirm(null);
    } else {
      setDeleteConfirm(id);
      setTimeout(() => setDeleteConfirm(null), 3000);
    }
  };

  const columns = gridColumnsFromZoom(zoom);

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragging(false);
  };

  const [dropResult, setDropResult] = useState<string | null>(null);

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const raw =
      e.dataTransfer.getData("text/uri-list") ||
      e.dataTransfer.getData("text/plain") ||
      "";
    const urls = Array.from(new Set(
      raw.split(/[\n\r]+/).map((s) => s.trim()).filter((s) => s.startsWith("http") && !s.startsWith("#"))
    ));
    if (urls.length === 0) return;

    setDropLoading(true);
    try {
      const items = await Promise.all(urls.map(async (url) => {
        const meta = await fetchMeta(url);
        let hostname = "";
        try { hostname = new URL(url).hostname; } catch { return null; }
        return {
          url,
          title: meta.title || hostname,
          description: meta.description || undefined,
          favicon: meta.favicon || `https://www.google.com/s2/favicons?domain=${hostname}&sz=32`,
          tags: effectiveSelectedTag ? [effectiveSelectedTag] : [],
          addedAt: localDateKey(),
        };
      }));
      const valid = items.filter((x): x is NonNullable<typeof x> => x !== null);
      importBookmarks(valid);
      const tagNote = effectiveSelectedTag ? ` · tagged "${effectiveSelectedTag}"` : "";
      setDropResult(`Imported ${valid.length} bookmark${valid.length !== 1 ? "s" : ""}${tagNote}`);
      setTimeout(() => setDropResult(null), 3000);
    } finally {
      setDropLoading(false);
    }
  };

  const handleBookmarkDragStart = (bookmarkId: string, e: React.DragEvent) => {
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData(BOOKMARK_DRAG_MIME, bookmarkId);
    e.dataTransfer.setData("text/plain", `${BOOKMARK_DRAG_FALLBACK_PREFIX}${bookmarkId}`);
  };

  const handleBookmarkDropOnTag = (bookmarkId: string, tag: string) => {
    replaceBookmarks(
      bookmarks.map((b) => {
        if (b.id !== bookmarkId || b.tags.includes(tag)) return b;
        return { ...b, tags: [...b.tags, tag] };
      })
    );
  };

  const handleReorderBookmark = (draggedId: string, targetId: string) => {
    if (draggedId === targetId) return;
    const visualOrder = sorted.map((b) => b.id);
    const from = visualOrder.indexOf(draggedId);
    const to = visualOrder.indexOf(targetId);
    if (from < 0 || to < 0) return;

    const nextVisible = [...visualOrder];
    nextVisible.splice(from, 1);
    nextVisible.splice(to, 0, draggedId);

    const hiddenIds = bookmarks
      .map((b) => b.id)
      .filter((id) => !nextVisible.includes(id));
    const finalOrder = [...nextVisible, ...hiddenIds];
    const total = finalOrder.length;
    const rankingMap = new Map(finalOrder.map((id, idx) => [id, total - idx]));

    replaceBookmarks(
      bookmarks.map((b) => ({
        ...b,
        ranking: rankingMap.get(b.id) ?? b.ranking ?? 0,
      }))
    );
    setSortBy("ranking");
    setGroupByDate(false);
  };

  const handleReorderSidebarTag = (draggedTag: string, targetTag: string) => {
    if (draggedTag === targetTag) return;
    const next = [...orderedSidebarTags];
    const from = next.indexOf(draggedTag);
    const to = next.indexOf(targetTag);
    if (from < 0 || to < 0) return;
    next.splice(from, 1);
    next.splice(to, 0, draggedTag);
    setTagOrder(next);
  };

  const handleBackup = () => {
    const data = JSON.stringify(bookmarks, null, 2);
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([data], { type: "application/json" }));
    a.download = `bookmarks-backup-${localDateKey()}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const handleRestoreFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const parsed = JSON.parse(ev.target?.result as string);
        if (!Array.isArray(parsed)) throw new Error("Not an array");
        if (!window.confirm(`Restore ${parsed.length} bookmarks? This will replace your current library.`)) return;
        replaceBookmarks(parsed);
      } catch {
        alert("Could not read backup file — make sure it's a valid bookmarks JSON.");
      }
    };
    reader.readAsText(file);
  };

  const handleCleanup = async () => {
    if (cleanupState.running) return;

    // Step 1: deduplicate by canonical URL (ignores protocol + www), merging tags/details.
    const dedupeIndex = new Map<string, number>();
    const deduped: Bookmark[] = [];
    for (const b of bookmarks) {
      const key = normaliseUrlForDedupe(b.url);
      const existingIdx = dedupeIndex.get(key);
      if (existingIdx === undefined) {
        dedupeIndex.set(key, deduped.length);
        deduped.push({ ...b, tags: Array.from(new Set(b.tags)) });
        continue;
      }
      const existing = deduped[existingIdx];
      deduped[existingIdx] = {
        ...existing,
        url: preferCanonicalUrl(existing.url, b.url),
        description: existing.description?.trim() ? existing.description : b.description,
        favicon: existing.favicon || b.favicon,
        tags: Array.from(new Set([...existing.tags, ...b.tags])),
      };
    }
    const removedCount = bookmarks.length - deduped.length;
    replaceBookmarks(deduped);

    // Step 2: enrich missing descriptions and recalculate reachability.
    const needsDesc = deduped.filter((b) => !b.description?.trim());
    setCleanupState({ running: true, progress: 0, total: needsDesc.length + deduped.length });

    let enrichedCount = 0;
    let nextBookmarks = [...deduped];
    for (let i = 0; i < needsDesc.length; i++) {
      const bookmark = needsDesc[i];
      const meta = await fetchMeta(bookmark.url);
      const newDesc = meta.description?.trim() || "";
      const newFavicon = meta.favicon || "";
      if (newDesc || newFavicon) {
        nextBookmarks = nextBookmarks.map((b) => {
          if (b.id !== bookmark.id) return b;
          const hadDescription = !!b.description?.trim();
          const updated = {
            ...b,
            ...(newDesc ? { description: newDesc } : {}),
            ...(newFavicon ? { favicon: newFavicon } : {}),
          };
          if (!hadDescription && !!updated.description?.trim()) enrichedCount++;
          return updated;
        });
      }
      setCleanupState((s) => ({ ...s, progress: i + 1 }));
    }

    for (let i = 0; i < nextBookmarks.length; i++) {
      const b = nextBookmarks[i];
      const reachable = await isReachable(b.url);
      const hasUnreachableTag = b.tags.includes(SYSTEM_TAG_NOT_REACHABLE);
      if (!reachable && !hasUnreachableTag) {
        nextBookmarks[i] = { ...b, tags: [...b.tags, SYSTEM_TAG_NOT_REACHABLE] };
      } else if (reachable && hasUnreachableTag) {
        nextBookmarks[i] = {
          ...b,
          tags: b.tags.filter((t) => t !== SYSTEM_TAG_NOT_REACHABLE),
        };
      }
      setCleanupState((s) => ({ ...s, progress: needsDesc.length + i + 1 }));
    }

    replaceBookmarks(nextBookmarks);
    setCleanupState({ running: false, progress: 0, total: 0 });
    setCleanupResult({
      removed: removedCount,
      missing: needsDesc.length,
      enriched: enrichedCount,
      skipped: needsDesc.length - enrichedCount,
    });
  };

  return (
    <>
      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
        @keyframes shimmer {
          0% { background-position: 200% 0; }
          100% { background-position: -200% 0; }
        }
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body { overflow: hidden; }
        ::-webkit-scrollbar { width: 6px; }
        ::-webkit-scrollbar-track { background: transparent; }
        ::-webkit-scrollbar-thumb { background: var(--border-hover); border-radius: 3px; }
      `}</style>

      <div data-theme={theme} style={{
        display: "flex", height: "100vh",
        background: "var(--bg)",
        fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
        color: "var(--text)", overflow: "hidden",
      }}>
        {/* Sidebar */}
        <aside style={{
          width: sidebarOpen ? 196 : 0,
          flexShrink: 0, background: "var(--surface)",
          borderRight: sidebarOpen ? "1px solid var(--border)" : "none",
          display: "flex", flexDirection: "column",
          overflowY: sidebarOpen ? "auto" : "hidden",
          overflowX: "hidden",
          transition: "width 0.22s ease, border 0.22s ease",
        }}>
          <div style={{
            width: 196, display: "flex", flexDirection: "column",
            padding: "20px 0", minHeight: "100%",
          }}>
            <div style={{ padding: "0 8px 14px 16px", display: "flex", alignItems: "center" }}>
              <span style={{ fontSize: 11, fontWeight: 700, color: "var(--text-4)", letterSpacing: "0.07em", textTransform: "uppercase", flex: 1 }}>
                Tags
              </span>
              <button
                onClick={() => { setNewTagInput(""); setTimeout(() => newTagRef.current?.focus(), 50); }}
                title="Create new tag"
                style={{
                  background: "none", border: "1px solid var(--border-hover)", borderRadius: 5,
                  color: "var(--text-3)", fontSize: 11, fontWeight: 600, cursor: "pointer",
                  padding: "2px 7px", lineHeight: 1.4,
                }}
              >
                + New
              </button>
            </div>
            {newTagInput !== null && (
              <div style={{ margin: "0 8px 8px", display: "flex", alignItems: "center", gap: 4 }}>
                <input
                  ref={newTagRef}
                  type="text"
                  value={newTagInput}
                  placeholder="tag-name"
                  onChange={(e) => setNewTagInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      addTag(newTagInput);
                      setNewTagInput(null);
                    }
                    if (e.key === "Escape") setNewTagInput(null);
                  }}
                  onBlur={() => setNewTagInput(null)}
                  style={{
                    flex: 1, background: "var(--bg)", border: "1px solid #3b82f6",
                    borderRadius: 6, padding: "4px 8px", color: "var(--text)", fontSize: 13, outline: "none",
                  }}
                />
              </div>
            )}
            <TagChip label="All" count={bookmarks.length} active={selectedTag === null} onClick={() => setSelectedTag(null)} vertical />
            <TagChip
              label="Not Tagged"
              count={bookmarks.filter((b) => visibleTags(b.tags).length === 0).length}
              active={selectedTag === NOT_TAGGED_FILTER}
              onClick={() => setSelectedTag(selectedTag === NOT_TAGGED_FILTER ? null : NOT_TAGGED_FILTER)}
              vertical
            />
            <TagChip
              label="Not Reachable"
              count={bookmarks.filter((b) => b.tags.includes(SYSTEM_TAG_NOT_REACHABLE)).length}
              active={selectedTag === NOT_REACHABLE_FILTER}
              onClick={() => setSelectedTag(selectedTag === NOT_REACHABLE_FILTER ? null : NOT_REACHABLE_FILTER)}
              vertical
            />
            <div style={{ height: 6 }} />
            {orderedSidebarTags.map((tag) => {
              const count = bookmarks.filter((b) => b.tags.includes(tag)).length;
              return (
                <SidebarTagRow
                  key={tag}
                  tag={tag}
                  count={count}
                  active={selectedTag === tag}
                  onSelect={() => setSelectedTag(selectedTag === tag ? null : tag)}
                  onRename={(newName) => renameTag(tag, newName)}
                  onDelete={() => setPendingTagDelete(tag)}
                  onBookmarkDrop={(bookmarkId) => handleBookmarkDropOnTag(bookmarkId, tag)}
                  onTagReorder={handleReorderSidebarTag}
                />
              );
            })}
          </div>
        </aside>

        {/* Main */}
        <div
          style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden", position: "relative" }}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
        >
          {/* Toolbar */}
          <header style={{
            display: "flex", alignItems: "center", gap: 8,
            padding: "9px 16px", borderBottom: "1px solid var(--border)",
            background: "var(--surface)", flexShrink: 0,
          }}>
            <button
              onClick={() => setSidebarOpen(v => !v)}
              title={sidebarOpen ? "Collapse sidebar" : "Expand sidebar"}
              style={{
                display: "flex", alignItems: "center", justifyContent: "center",
                width: 28, height: 28, borderRadius: 7, border: "none",
                background: "var(--card)", color: "var(--text-2)",
                cursor: "pointer", flexShrink: 0,
              }}
            >
              <IconSidebar flipped={!sidebarOpen} />
            </button>
            <button
              onClick={() => setTheme(t => t === "dark" ? "light" : "dark")}
              title={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
              style={{
                display: "flex", alignItems: "center", justifyContent: "center",
                width: 28, height: 28, borderRadius: 7, border: "none",
                background: "var(--card)", color: "var(--text-2)",
                cursor: "pointer", flexShrink: 0,
              }}
            >
              {theme === "dark" ? <IconSun /> : <IconMoon />}
            </button>
            <a href="https://www.bookmarkmaster.com" target="_blank" rel="noreferrer"
              style={{ fontSize: 15, fontWeight: 700, marginRight: 4, color: "var(--text)", textDecoration: "none" }}
              onMouseEnter={(e) => (e.currentTarget.style.textDecoration = "underline")}
              onMouseLeave={(e) => (e.currentTarget.style.textDecoration = "none")}
            >BookmarkMaster.com</a>

            <div style={{ flex: 1 }} />

            <input type="text" placeholder="Search… or #tag" value={search}
              onChange={(e) => setSearch(e.target.value)}
              style={{ background: "var(--card)", border: "1px solid var(--border-hover)", borderRadius: 7, padding: "6px 12px", color: "var(--text)", fontSize: 13, outline: "none", width: 220 }}
            />

            <span style={{ fontSize: 12, color: "var(--text-4)", minWidth: 24, textAlign: "right" }}>
              {sorted.length}
            </span>

            <Divider />

            {/* View mode */}
            <ToggleGroup>
              <ToggleBtn active={displayMode === "grid"} onClick={() => setDisplayMode("grid")} title="Tile view" icon={<IconTile />} />
              <ToggleBtn active={displayMode === "list"} onClick={() => setDisplayMode("list")} title="Table view" icon={<IconTable />} />
              <ToggleBtn active={displayMode === "preview"} onClick={() => setDisplayMode("preview")} title="Preview view" icon={<IconPreview />} />
            </ToggleGroup>

            {/* Layer toggles */}
            <ToggleGroup>
              <ToggleBtn active={groupByDate} onClick={() => setGroupByDate(v => !v)} title="Group by date" icon={<IconCalendar />} />
            </ToggleGroup>

            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as typeof sortBy)}
              title="Sort order"
              style={{
                background: "var(--card)", border: "1px solid var(--border-hover)",
                borderRadius: 7, padding: "0 8px", color: "var(--text-2)",
                fontSize: 13, cursor: "pointer", outline: "none",
                height: 30, boxSizing: "border-box",
              }}
            >
              <option value="date">Date added</option>
              <option value="name">Name A–Z</option>
              <option value="ranking">Ranking</option>
            </select>

            <div ref={dataMenuRef} style={{ position: "relative" }}>
              <button
                onClick={() => setShowDataMenu((v) => !v)}
                style={{
                  display: "flex", alignItems: "center", gap: 5,
                  padding: "0 10px", height: 30, background: "var(--card)",
                  border: "1px solid var(--border-hover)",
                  borderRadius: 7, color: "var(--text-2)", fontSize: 13, cursor: "pointer",
                  boxSizing: "border-box",
                }}
              >
                {cleanupState.running ? (
                  <span style={{ display: "inline-block", width: 13, height: 13, border: "2px solid var(--border-hover)", borderTopColor: "#3b82f6", borderRadius: "50%", animation: "spin 0.7s linear infinite" }} />
                ) : null}
                My Data
                <span style={{ fontSize: 9, opacity: 0.5, marginLeft: 1 }}>▾</span>
              </button>

              {showDataMenu && (
                <div style={{
                  position: "absolute", top: "calc(100% + 6px)", left: 0,
                  background: "var(--card)", border: "1px solid var(--border-hover)",
                  borderRadius: 10, padding: "4px 0", zIndex: 200,
                  minWidth: 160, boxShadow: "0 8px 32px rgba(0,0,0,0.4)",
                }}>
                  <DataMenuItem
                    icon={<img src="/broom.png" alt="" style={{ width: 15, height: 15, opacity: 0.65, filter: "var(--icon-filter)" }} />}
                    label="Clean up"
                    disabled={cleanupState.running}
                    onClick={() => { setShowDataMenu(false); handleCleanup(); }}
                  />
                  <div style={{ height: 1, background: "var(--border)", margin: "4px 0" }} />
                  <DataMenuItem icon={<img src="/file-import.png" alt="" style={{ width: 15, height: 15, opacity: 0.65, filter: "var(--icon-filter)" }} />} label="Import" onClick={() => { setShowDataMenu(false); setShowImport(true); }} />
                  <DataMenuItem icon={<img src="/import-export.png" alt="" style={{ width: 15, height: 15, opacity: 0.65, filter: "var(--icon-filter)" }} />} label="Export" onClick={() => { setShowDataMenu(false); setShowExport(true); }} />
                  <div style={{ height: 1, background: "var(--border)", margin: "4px 0" }} />
                  <DataMenuItem icon="💾" label="Backup" onClick={() => { setShowDataMenu(false); handleBackup(); }} />
                  <DataMenuItem icon="📂" label="Restore" onClick={() => { setShowDataMenu(false); restoreFileRef.current?.click(); }} />
                  <div style={{ height: 1, background: "var(--border)", margin: "4px 0" }} />
                  <DataMenuItem icon="🗑️" label="Delete All" danger onClick={() => { setShowDataMenu(false); setShowDeleteAll(true); }} />
                </div>
              )}
            </div>

            <input ref={restoreFileRef} type="file" accept=".json" style={{ display: "none" }} onChange={handleRestoreFile} />

            <Divider />

            {incomingTab && (
              <button
                onClick={() => setModal({ mode: "add", prefill: incomingTab })}
                title={`Save: ${incomingTab.url}`}
                style={{
                  display: "flex", alignItems: "center", gap: 6,
                  padding: "6px 12px", background: "#16a34a", border: "none",
                  borderRadius: 7, color: "#fff", fontSize: 13, fontWeight: 600, cursor: "pointer",
                  maxWidth: 200, overflow: "hidden",
                }}
              >
                {incomingTab.favicon && (
                  <img src={incomingTab.favicon} width={14} height={14}
                    style={{ borderRadius: 2, flexShrink: 0 }}
                    onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
                  />
                )}
                <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  Save tab
                </span>
              </button>
            )}
            <button onClick={() => setModal({ mode: "add" })} style={{
              display: "flex", alignItems: "center", gap: 5,
              padding: "6px 12px", background: "#3b82f6", border: "none",
              borderRadius: 7, color: "#fff", fontSize: 13, fontWeight: 600, cursor: "pointer",
            }}>
              <span style={{ fontSize: 15, lineHeight: 1 }}>+</span> Add
            </button>
          </header>


          {/* Content */}
          <main style={{ flex: 1, overflowY: "auto", padding: 16 }}>
            {sorted.length === 0 ? (
              <Empty onAdd={() => setModal({ mode: "add" })} />
            ) : displayMode === "list" ? (
              <ListView
                bookmarks={sorted}
                zoom={zoom}
                onTagClick={setSelectedTag}
                onEdit={(b) => setModal({ mode: "edit", bookmark: b })}
                onDelete={handleDelete}
                onDragStartBookmark={handleBookmarkDragStart}
                showPreview={false}
                groupByDate={effectiveGroupByDate}
                deleteConfirmId={deleteConfirm}
              />
            ) : (
              // Grid mode: plain grid or grouped
              effectiveGroupByDate ? (
                <TimelineView
                  bookmarks={sorted}
                  zoom={zoom}
                  onTagClick={setSelectedTag}
                  onEdit={(b) => setModal({ mode: "edit", bookmark: b })}
                  onDelete={handleDelete}
                  onDragStartBookmark={handleBookmarkDragStart}
                  onDropBookmarkOnBookmark={handleReorderBookmark}
                  showPreview={displayMode === "preview"}
                  groupByDate={effectiveGroupByDate}
                  deleteConfirmId={deleteConfirm}
                />
              ) : (
                <div style={{ display: "grid", gridTemplateColumns: `repeat(${columns}, 1fr)`, gap: 10 }}>
                  {sorted
                    .map((b) => (
                      <BookmarkCard
                        key={b.id}
                        bookmark={b}
                        zoom={zoom}
                        onTagClick={setSelectedTag}
                        onEdit={() => setModal({ mode: "edit", bookmark: b })}
                        onDelete={() => handleDelete(b.id)}
                        onDragStartBookmark={handleBookmarkDragStart}
                        onDropBookmarkOnBookmark={handleReorderBookmark}
                        showPreview={displayMode === "preview"}
                        deleteConfirming={deleteConfirm === b.id}
                      />
                    ))}
                </div>
              )
            )}
          </main>

          {/* Drag-over overlay */}
          {(dragging || dropLoading) && (
            <div style={{
              position: "absolute", inset: 0, zIndex: 50,
              background: "rgba(17,17,19,0.88)",
              backdropFilter: "blur(4px)",
              display: "flex", flexDirection: "column",
              alignItems: "center", justifyContent: "center", gap: 16,
              border: "2px dashed #3b82f6",
              borderRadius: 2, pointerEvents: "none",
            }}>
              {dropLoading ? (
                <>
                  <div style={{ width: 32, height: 32, border: "3px solid #3b82f633", borderTop: "3px solid #3b82f6", borderRadius: "50%", animation: "spin 0.7s linear infinite" }} />
                  <span style={{ fontSize: 14, color: "var(--text-2)" }}>Fetching page info…</span>
                </>
              ) : (
                <>
                  <svg width="40" height="40" viewBox="0 0 40 40" fill="none" stroke="#3b82f6" strokeWidth="2">
                    <rect x="4" y="4" width="32" height="32" rx="6" />
                    <path d="M20 14v12M14 20l6-6 6 6" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                  <span style={{ fontSize: 15, fontWeight: 600, color: "var(--text)" }}>Drop to import bookmark{effectiveSelectedTag ? "s" : ""}</span>
                  {effectiveSelectedTag ? (
                    <span style={{ fontSize: 12, color: "#3b82f6" }}>Will be tagged "{effectiveSelectedTag}"</span>
                  ) : (
                    <span style={{ fontSize: 12, color: "var(--text-3)" }}>Drag from the address bar or any link</span>
                  )}
                </>
              )}
            </div>
          )}

          {/* Drop success toast */}
          {dropResult && (
            <div style={{
              position: "absolute", bottom: 60, left: "50%", transform: "translateX(-50%)",
              zIndex: 60, background: "#16a34a", color: "#fff",
              padding: "8px 18px", borderRadius: 20, fontSize: 13, fontWeight: 600,
              boxShadow: "0 4px 20px rgba(0,0,0,0.4)", pointerEvents: "none",
              whiteSpace: "nowrap",
            }}>
              ✓ {dropResult}
            </div>
          )}

          {/* Footer — zoom slider for tile/preview grid modes */}
          {displayMode !== "list" && (
            <footer style={{
              display: "flex", alignItems: "center", justifyContent: "flex-end",
              padding: "7px 16px", borderTop: "1px solid var(--border)",
              background: "var(--surface)", gap: 6, flexShrink: 0,
            }}>
              <SmallGridIcon size={11} />
              <input type="range" min={1} max={5} step={0.25} value={zoom}
                onChange={(e) => setZoom(Number(e.target.value))}
                style={{ width: 100, accentColor: "#3b82f6", cursor: "pointer" }}
              />
              <SmallGridIcon size={17} />
            </footer>
          )}
        </div>

        {modal.mode !== "closed" && (
          <BookmarkModal
            initial={modal.mode === "edit" ? modal.bookmark : null}
            prefill={modal.mode === "add" ? modal.prefill : undefined}
            existingTags={allTags}
            onSave={handleSave}
            onClose={() => setModal({ mode: "closed" })}
          />
        )}

        {showImport && (
          <ImportExportModal
            bookmarks={bookmarks}
            onImport={importBookmarks}
            onClose={() => setShowImport(false)}
            selectedTag={effectiveSelectedTag}
            allTags={allTags}
            section="import"
          />
        )}

        {showExport && (
          <ImportExportModal
            bookmarks={bookmarks}
            onImport={importBookmarks}
            onClose={() => setShowExport(false)}
            selectedTag={effectiveSelectedTag}
            allTags={allTags}
            section="export"
          />
        )}

        {showDeleteAll && (
          <div
            onClick={() => setShowDeleteAll(false)}
            style={{
              position: "fixed", inset: 0, background: "rgba(0,0,0,0.65)",
              backdropFilter: "blur(4px)", display: "flex",
              alignItems: "center", justifyContent: "center", zIndex: 1000,
            }}
          >
            <div
              onClick={(e) => e.stopPropagation()}
              style={{
                background: "var(--card)", border: "1px solid #ef444440",
                borderRadius: 14, padding: 28, width: 340,
                display: "flex", flexDirection: "column", gap: 18,
                boxShadow: "0 24px 60px rgba(0,0,0,0.6)",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                <span style={{ fontSize: 28 }}>🗑️</span>
                <h2 style={{ fontSize: 16, fontWeight: 700, color: "#ef4444", margin: 0 }}>Delete all bookmarks?</h2>
              </div>
              <p style={{ fontSize: 13, color: "var(--text-2)", lineHeight: 1.6, margin: 0 }}>
                This will permanently remove all <strong style={{ color: "var(--text)" }}>{bookmarks.length} bookmark{bookmarks.length !== 1 ? "s" : ""}</strong> from your library. Consider doing a <strong style={{ color: "var(--text)" }}>Backup</strong> first — this cannot be undone.
              </p>
              <div style={{ display: "flex", gap: 8 }}>
                <button
                  onClick={() => setShowDeleteAll(false)}
                  style={{
                    flex: 1, background: "var(--border)", border: "1px solid var(--border-hover)",
                    borderRadius: 8, padding: "9px 0", color: "var(--text-2)",
                    fontSize: 13, fontWeight: 600, cursor: "pointer",
                  }}
                >
                  Cancel
                </button>
                <button
                  onClick={() => { replaceBookmarks([]); setShowDeleteAll(false); }}
                  style={{
                    flex: 1, background: "#ef4444", border: "none",
                    borderRadius: 8, padding: "9px 0", color: "#fff",
                    fontSize: 13, fontWeight: 700, cursor: "pointer",
                  }}
                >
                  Delete all
                </button>
              </div>
            </div>
          </div>
        )}

        {pendingTagDelete && (
          <div
            onClick={() => setPendingTagDelete(null)}
            style={{
              position: "fixed", inset: 0, background: "rgba(0,0,0,0.65)",
              backdropFilter: "blur(4px)", display: "flex",
              alignItems: "center", justifyContent: "center", zIndex: 1000,
            }}
          >
            <div
              onClick={(e) => e.stopPropagation()}
              style={{
                background: "var(--card)", border: "1px solid #ef444440",
                borderRadius: 14, padding: 24, width: 340,
                display: "flex", flexDirection: "column", gap: 14,
                boxShadow: "0 24px 60px rgba(0,0,0,0.6)",
              }}
            >
              <h2 style={{ fontSize: 16, fontWeight: 700, color: "#ef4444", margin: 0 }}>
                Delete tag "{pendingTagDelete}"?
              </h2>
              <p style={{ fontSize: 13, color: "var(--text-2)", lineHeight: 1.6, margin: 0 }}>
                This will remove the tag from the sidebar and from all bookmarks currently using it.
              </p>
              <div style={{ display: "flex", gap: 8 }}>
                <button
                  onClick={() => setPendingTagDelete(null)}
                  style={{
                    flex: 1, background: "var(--border)", border: "1px solid var(--border-hover)",
                    borderRadius: 8, padding: "9px 0", color: "var(--text-2)",
                    fontSize: 13, fontWeight: 600, cursor: "pointer",
                  }}
                >
                  Cancel
                </button>
                <button
                  onClick={() => {
                    deleteTag(pendingTagDelete);
                    if (selectedTag === pendingTagDelete) setSelectedTag(null);
                    setPendingTagDelete(null);
                  }}
                  style={{
                    flex: 1, background: "#ef4444", border: "none",
                    borderRadius: 8, padding: "9px 0", color: "#fff",
                    fontSize: 13, fontWeight: 700, cursor: "pointer",
                  }}
                >
                  Delete tag
                </button>
              </div>
            </div>
          </div>
        )}

        {cleanupResult && (
          <div
            onClick={() => setCleanupResult(null)}
            style={{
              position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)",
              backdropFilter: "blur(4px)", display: "flex",
              alignItems: "center", justifyContent: "center", zIndex: 1000,
            }}
          >
            <div
              onClick={(e) => e.stopPropagation()}
              style={{
                background: "var(--card)", border: "1px solid var(--border-hover)",
                borderRadius: 14, padding: 28, width: 340,
                display: "flex", flexDirection: "column", gap: 16,
                boxShadow: "0 24px 60px rgba(0,0,0,0.6)",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <span style={{ fontSize: 22 }}><BroomIcon /></span>
                <h2 style={{ fontSize: 16, fontWeight: 700, color: "var(--text)", margin: 0 }}>Clean up complete</h2>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                <ResultRow icon="🗑️" label="Duplicates removed" value={cleanupResult.removed} />
                <ResultRow icon="🔍" label="Missing descriptions found" value={cleanupResult.missing} />
                <ResultRow icon="📝" label="Descriptions filled" value={cleanupResult.enriched} />
                <ResultRow icon="⚠️" label="Still missing (could not fetch)" value={cleanupResult.skipped} dim />
              </div>
              {cleanupResult.removed === 0 && cleanupResult.missing === 0 && (
                <p style={{ fontSize: 13, color: "var(--text-3)", margin: 0 }}>Everything looks clean — no duplicates or missing descriptions found.</p>
              )}
              <button
                onClick={() => setCleanupResult(null)}
                style={{
                  background: "var(--border)", border: "1px solid var(--border-hover)",
                  borderRadius: 8, padding: "8px 0", color: "var(--text-2)",
                  fontSize: 13, cursor: "pointer", fontWeight: 600,
                }}
              >
                Done
              </button>
            </div>
          </div>
        )}
      </div>
    </>
  );
}

function ResultRow({ icon, label, value, dim }: { icon: string; label: string; value: number; dim?: boolean }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, opacity: dim && value === 0 ? 0.3 : 1 }}>
      <span style={{ fontSize: 16, width: 24, textAlign: "center" }}>{icon}</span>
      <span style={{ flex: 1, fontSize: 13, color: "var(--text-2)" }}>{label}</span>
      <span style={{ fontSize: 15, fontWeight: 700, color: value > 0 ? "var(--text)" : "var(--text-4)" }}>{value}</span>
    </div>
  );
}

// ── Small components ─────────────────────────────────────────────────────────

function TagChip({ label, count, active, color, onClick, vertical = false }: {
  label: string; count: number; active: boolean; color?: string; onClick: () => void; vertical?: boolean;
}) {
  const c = color ?? "var(--text-2)";
  return (
    <button onClick={onClick} style={{
      display: "flex", alignItems: "center", gap: 8,
      padding: vertical ? "6px 12px" : "4px 10px",
      borderRadius: vertical ? 6 : 99,
      border: "none", cursor: "pointer",
      background: active ? (color ? color + "22" : "var(--border)") : "transparent",
      color: active ? (color ?? "var(--text)") : "var(--text-2)",
      fontSize: 13, fontWeight: active ? 600 : 400,
      whiteSpace: "nowrap", flexShrink: vertical ? undefined : 0,
      width: vertical ? "calc(100% - 16px)" : undefined,
      margin: vertical ? "1px 8px" : undefined,
      textAlign: "left",
      transition: "background 0.1s, color 0.1s",
    }}>
      {color
        ? <span style={{ width: 8, height: 8, borderRadius: "50%", background: c, display: "inline-block", flexShrink: 0 }} />
        : <span style={{ fontSize: 13 }}>◈</span>
      }
      <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{label}</span>
      <span style={{ marginLeft: "auto", fontSize: 11, color: "var(--text-4)", flexShrink: 0 }}>{count}</span>
    </button>
  );
}

function Divider() {
  return <div style={{ width: 1, height: 18, background: "var(--border)", flexShrink: 0 }} />;
}

function ToggleGroup({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ display: "flex", background: "var(--card)", border: "1px solid var(--border)", borderRadius: 7, overflow: "hidden" }}>
      {children}
    </div>
  );
}

function ToggleBtn({ active, onClick, title, icon, disabled }: {
  active: boolean; onClick: () => void; title: string; icon: React.ReactNode; disabled?: boolean;
}) {
  return (
    <button onClick={onClick} title={title} disabled={disabled} style={{
      display: "flex", alignItems: "center", justifyContent: "center",
      padding: "5px 9px", background: active ? "var(--border-hover)" : "transparent",
      border: "none", color: disabled ? "var(--text-4)" : active ? "var(--text)" : "var(--text-3)",
      cursor: disabled ? "not-allowed" : "pointer",
      transition: "background 0.1s, color 0.1s",
      opacity: disabled ? 0.5 : 1,
    }}>
      {icon}
    </button>
  );
}


function Empty({ onAdd }: { onAdd: () => void }) {
  return (
    <div style={{ textAlign: "center", color: "var(--text-4)", marginTop: 80 }}>
      <div style={{ fontSize: 15, marginBottom: 12 }}>No bookmarks found</div>
      <button onClick={onAdd} style={{
        background: "#3b82f620", border: "1px solid #3b82f640",
        borderRadius: 8, color: "#3b82f6", fontSize: 13, padding: "7px 16px", cursor: "pointer",
      }}>
        Add your first bookmark
      </button>
    </div>
  );
}

function SmallGridIcon({ size }: { size: number }) {
  const s = size * 0.38;
  const g = size * 0.08;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} fill="var(--text-3)">
      <rect x={0} y={0} width={s} height={s} rx={1} />
      <rect x={s + g} y={0} width={s} height={s} rx={1} />
      <rect x={0} y={s + g} width={s} height={s} rx={1} />
      <rect x={s + g} y={s + g} width={s} height={s} rx={1} />
    </svg>
  );
}

// Icons
function IconTile() {
  return (
    <svg width="15" height="15" viewBox="0 0 15 15" fill="currentColor">
      <rect x="0" y="0" width="6" height="6" rx="1.5" />
      <rect x="8" y="0" width="6" height="6" rx="1.5" />
      <rect x="0" y="8" width="6" height="6" rx="1.5" />
      <rect x="8" y="8" width="6" height="6" rx="1.5" />
    </svg>
  );
}

function IconTable() {
  return (
    <svg width="15" height="15" viewBox="0 0 15 15" fill="currentColor">
      <rect x="0" y="1" width="15" height="2" rx="1" />
      <rect x="0" y="6" width="15" height="2" rx="1" />
      <rect x="0" y="11" width="15" height="2" rx="1" />
    </svg>
  );
}


function IconPreview() {
  return (
    <svg width="13" height="13" viewBox="0 0 13 13" fill="currentColor">
      <rect x="0" y="0" width="13" height="9" rx="2" opacity="0.4" />
      <rect x="0" y="0" width="13" height="5.5" rx="2" />
      <rect x="0" y="10.5" width="5" height="1.5" rx="0.75" />
      <rect x="0" y="10.5" width="8" height="1.5" rx="0.75" opacity="0.4" />
    </svg>
  );
}

function IconCalendar() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="4" width="18" height="17" rx="3" />
      <line x1="8" y1="2.5" x2="8" y2="6" />
      <line x1="16" y1="2.5" x2="16" y2="6" />
      <line x1="3" y1="9" x2="21" y2="9" />
      <line x1="8" y1="13" x2="8" y2="13" />
      <line x1="12" y1="13" x2="12" y2="13" />
      <line x1="16" y1="13" x2="16" y2="13" />
      <line x1="8" y1="17" x2="8" y2="17" />
      <line x1="12" y1="17" x2="12" y2="17" />
      <line x1="16" y1="17" x2="16" y2="17" />
    </svg>
  );
}

function IconSun() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="5" />
      <line x1="12" y1="1" x2="12" y2="3" />
      <line x1="12" y1="21" x2="12" y2="23" />
      <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" />
      <line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
      <line x1="1" y1="12" x2="3" y2="12" />
      <line x1="21" y1="12" x2="23" y2="12" />
      <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" />
      <line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
    </svg>
  );
}

function IconMoon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
    </svg>
  );
}

function SidebarTagRow({ tag, count, active, onSelect, onRename, onDelete, onBookmarkDrop, onTagReorder }: {
  tag: string; count: number; active: boolean;
  onSelect: () => void;
  onRename: (newName: string) => void;
  onDelete: () => void;
  onBookmarkDrop: (bookmarkId: string) => void;
  onTagReorder: (draggedTag: string, targetTag: string) => void;
}) {
  const [hovered, setHovered] = useState(false);
  const [editing, setEditing] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const skipSave = useRef(false);
  const c = tagColor(tag);

  const handleSave = () => {
    if (skipSave.current) { skipSave.current = false; return; }
    const val = inputRef.current?.value?.trim() ?? "";
    onRename(val);
    setEditing(false);
  };

  if (editing) {
    return (
      <div style={{ margin: "1px 8px", display: "flex", alignItems: "center", gap: 4 }}>
        <input
          ref={inputRef}
          autoFocus
          defaultValue={tag}
          onKeyDown={(e) => {
            if (e.key === "Enter") handleSave();
            if (e.key === "Escape") { skipSave.current = true; setEditing(false); }
          }}
          onBlur={handleSave}
          style={{
            flex: 1, background: "var(--bg)", border: "1px solid #3b82f6",
            borderRadius: 6, padding: "4px 8px", color: "var(--text)", fontSize: 13, outline: "none",
          }}
        />
      </div>
    );
  }

  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => { setHovered(false); }}
      draggable={!editing}
      onDragStart={(e) => {
        e.dataTransfer.effectAllowed = "move";
        e.dataTransfer.setData(TAG_DRAG_MIME, tag);
      }}
      onDragOver={(e) => {
        const hasBookmarkData = e.dataTransfer.types.includes(BOOKMARK_DRAG_MIME);
        const hasTagData = e.dataTransfer.types.includes(TAG_DRAG_MIME);
        if (!hasBookmarkData && !hasTagData) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
        setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragOver(false);
        const draggedTag = e.dataTransfer.getData(TAG_DRAG_MIME);
        if (draggedTag) {
          onTagReorder(draggedTag, tag);
          return;
        }
        const directId = e.dataTransfer.getData(BOOKMARK_DRAG_MIME);
        const plain = e.dataTransfer.getData("text/plain");
        const fallbackId = plain.startsWith(BOOKMARK_DRAG_FALLBACK_PREFIX)
          ? plain.slice(BOOKMARK_DRAG_FALLBACK_PREFIX.length)
          : "";
        const bookmarkId = directId || fallbackId;
        if (!bookmarkId) return;
        onBookmarkDrop(bookmarkId);
      }}
      style={{
        display: "flex", alignItems: "center",
        width: "calc(100% - 16px)", margin: "1px 8px", borderRadius: 6,
        background: dragOver ? c + "33" : active ? c + "22" : "transparent",
        transition: "background 0.1s",
      }}
    >
      <button
        onClick={onSelect}
        style={{
          flex: 1, display: "flex", alignItems: "center", gap: 8,
          padding: "6px 8px", background: "none", border: "none",
          color: active ? c : hovered ? "var(--text)" : "var(--text-2)",
          fontSize: 13, fontWeight: active ? 600 : 400,
          cursor: "pointer", textAlign: "left", overflow: "hidden",
          transition: "color 0.1s",
        }}
      >
        <span style={{ width: 8, height: 8, borderRadius: "50%", background: c, flexShrink: 0, display: "inline-block" }} />
        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1 }}>{tag}</span>
        {!hovered && <span style={{ fontSize: 11, color: "var(--text-4)", flexShrink: 0 }}>{count}</span>}
      </button>

      {hovered && (
        <div style={{ display: "flex", gap: 2, paddingRight: 4, flexShrink: 0 }}>
          <button
            onClick={(e) => { e.stopPropagation(); setEditing(true); }}
            title="Rename tag"
            style={tagActionBtn}
          >
            ✏
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); onDelete(); }}
            title="Delete tag from all bookmarks"
            style={tagActionBtn}
          >
            ×
          </button>
        </div>
      )}
    </div>
  );
}

const tagActionBtn: React.CSSProperties = {
  display: "flex", alignItems: "center", justifyContent: "center",
  width: 22, height: 22, borderRadius: 5, border: "none",
  background: "var(--border-hover)", color: "var(--text-3)",
  cursor: "pointer", fontSize: 12, flexShrink: 0,
};

function DataMenuItem({ icon, label, onClick, disabled, danger }: { icon: React.ReactNode; label: string; onClick: () => void; disabled?: boolean; danger?: boolean }) {
  const [hovered, setHovered] = useState(false);
  const color = disabled ? "var(--text-4)" : danger ? "#ef4444" : "var(--text-2)";
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        display: "flex", alignItems: "center", gap: 10,
        width: "100%", padding: "7px 14px",
        background: hovered ? (danger ? "#ef444420" : "var(--border)") : "none",
        border: "none", color,
        fontSize: 13, cursor: disabled ? "not-allowed" : "pointer",
        textAlign: "left",
      }}
    >
      <span style={{ width: 18, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14 }}>{icon}</span>
      {label}
    </button>
  );
}

function BroomIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 21l9-9" />
      <path d="M12.5 2.5l9 9-3.5 3.5-2-2-3 3-2-2 3-3-2-2z" />
      <path d="M6 18c-1.5 1-3 1.5-4 1 .5-1 1-2.5 2-4" />
    </svg>
  );
}

function IconSidebar({ flipped }: { flipped?: boolean }) {
  return (
    <svg width="15" height="15" viewBox="0 0 15 15" fill="currentColor"
      style={{ transform: flipped ? "scaleX(-1)" : "none", transition: "transform 0.22s ease" }}>
      <rect x="1" y="1" width="13" height="13" rx="2" opacity="0.25" />
      <rect x="1" y="1" width="4" height="13" rx="2" />
      <rect x="7" y="4" width="5" height="1.5" rx="0.75" opacity="0.6" />
      <rect x="7" y="7" width="5" height="1.5" rx="0.75" opacity="0.6" />
      <rect x="7" y="10" width="3" height="1.5" rx="0.75" opacity="0.6" />
    </svg>
  );
}
