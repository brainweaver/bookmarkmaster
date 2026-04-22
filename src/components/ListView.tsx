import { useEffect, useState } from "react";
import type { Bookmark } from "../data/mockBookmarks";
import { tagColor } from "./BookmarkCard";
import { visibleTags } from "../constants/tags";
import { previewCandidatesForLink } from "../utils/preview";

const THUMB_W = [52,  92, 164, 292, 520];
const THUMB_H = [33,  58, 104, 184, 328];
const LIST_COL_WIDTHS_KEY = "ui_list_col_widths_v1";

type ListColumnKey = "title" | "url" | "tags" | "added";
type ListColumnWidths = Record<ListColumnKey, number>;

const DEFAULT_COLUMN_WIDTHS: ListColumnWidths = {
  title: 180,
  url: 160,
  tags: 180,
  added: 80,
};

const MIN_COLUMN_WIDTHS: ListColumnWidths = {
  title: 120,
  url: 120,
  tags: 120,
  added: 72,
};

function loadColumnWidths(): ListColumnWidths {
  try {
    const raw = localStorage.getItem(LIST_COL_WIDTHS_KEY);
    if (!raw) return DEFAULT_COLUMN_WIDTHS;
    const parsed = JSON.parse(raw) as Partial<ListColumnWidths>;
    return {
      title: clampColumnWidth("title", Number(parsed.title ?? DEFAULT_COLUMN_WIDTHS.title)),
      url: clampColumnWidth("url", Number(parsed.url ?? DEFAULT_COLUMN_WIDTHS.url)),
      tags: clampColumnWidth("tags", Number(parsed.tags ?? DEFAULT_COLUMN_WIDTHS.tags)),
      added: clampColumnWidth("added", Number(parsed.added ?? DEFAULT_COLUMN_WIDTHS.added)),
    };
  } catch {
    return DEFAULT_COLUMN_WIDTHS;
  }
}

function clampColumnWidth(key: ListColumnKey, width: number): number {
  const safe = Number.isFinite(width) ? width : DEFAULT_COLUMN_WIDTHS[key];
  return Math.max(MIN_COLUMN_WIDTHS[key], Math.min(560, Math.round(safe)));
}

interface RowProps {
  bookmark: Bookmark;
  zoom: number;
  colWidths: ListColumnWidths;
  onTagClick: (tag: string) => void;
  onEdit: () => void;
  onDelete: () => void;
  onDragStartBookmark: (bookmarkId: string, e: React.DragEvent) => void;
  onDropBookmarkOnBookmark?: (draggedId: string, targetId: string) => void;
  showPreview: boolean;
  deleteConfirming: boolean;
}

function ListRow({ bookmark, zoom, colWidths, onTagClick, onEdit, onDelete, onDragStartBookmark, onDropBookmarkOnBookmark, showPreview, deleteConfirming }: RowProps) {
  const [hovered, setHovered] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [previewLoaded, setPreviewLoaded] = useState(false);
  const [previewError, setPreviewError] = useState(false);
  const [previewIndex, setPreviewIndex] = useState(0);
  const [faviconError, setFaviconError] = useState(false);
  const initial = bookmark.title[0]?.toUpperCase() ?? "?";
  const zoomIndex = Math.min(THUMB_W.length - 1, Math.max(0, Math.round(zoom) - 1));
  const previewSources = previewCandidatesForLink(bookmark.url);
  const previewSrc = previewSources[Math.min(previewIndex, Math.max(0, previewSources.length - 1))] || "";

  useEffect(() => {
    setPreviewLoaded(false);
    setPreviewError(false);
    setPreviewIndex(0);
  }, [bookmark.url]);

  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      draggable
      onDragStart={(e) => onDragStartBookmark(bookmark.id, e)}
      onDragOver={(e) => {
        if (!onDropBookmarkOnBookmark) return;
        e.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => {
        if (!onDropBookmarkOnBookmark) return;
        e.preventDefault();
        setDragOver(false);
        const draggedId =
          e.dataTransfer.getData("application/x-bookmark-id") ||
          e.dataTransfer.getData("text/plain").replace(/^bookmark:/, "");
        if (!draggedId) return;
        onDropBookmarkOnBookmark(draggedId, bookmark.id);
      }}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: "7px 12px",
        background: dragOver ? "var(--card)" : hovered ? "var(--card)" : "transparent",
        borderRadius: 8,
        border: `1px solid ${dragOver ? "#3b82f6" : "transparent"}`,
        transition: "background 0.1s, border-color 0.1s",
        position: "relative",
        minWidth: 0,
      }}
    >
      {/* Thumbnail */}
      {showPreview && !previewError && (
        <div
          style={{
            width: THUMB_W[zoomIndex],
            height: THUMB_H[zoomIndex],
            minWidth: THUMB_W[zoomIndex],
            minHeight: THUMB_H[zoomIndex],
            borderRadius: 6,
            overflow: "hidden",
            background: "var(--border)",
            flexShrink: 0,
            position: "relative",
          }}
        >
          {/* shimmer skeleton */}
          <div
            style={{
              position: "absolute", inset: 0,
              background: "linear-gradient(90deg, #2c2c2e 25%, var(--border-hover) 50%, #2c2c2e 75%)",
              backgroundSize: "200% 100%",
              animation: "shimmer 1.5s infinite",
              opacity: previewLoaded ? 0 : 1,
              transition: "opacity 0.3s",
            }}
          />
          {/* image absolutely positioned — never affects row layout */}
          <img
            src={previewSrc}
            alt=""
            onLoad={() => setPreviewLoaded(true)}
            onError={() => {
              if (previewIndex < previewSources.length - 1) {
                setPreviewLoaded(false);
                setPreviewIndex((i) => i + 1);
                return;
              }
              setPreviewError(true);
            }}
            style={{
              position: "absolute",
              top: 0, left: 0,
              width: "100%",
              height: "100%",
              objectFit: "cover",
              objectPosition: "top",
              opacity: previewLoaded ? 1 : 0,
              transition: "opacity 0.3s",
            }}
          />
        </div>
      )}

      {/* Favicon */}
      {faviconError ? (
        <div
          style={{
            width: 18,
            height: 18,
            borderRadius: 4,
            background: "var(--border-hover)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 10,
            fontWeight: 700,
            color: "var(--text-2)",
            flexShrink: 0,
          }}
        >
          {initial}
        </div>
      ) : (
        <img
          src={bookmark.favicon}
          alt=""
          width={18}
          height={18}
          style={{ borderRadius: 4, objectFit: "contain", flexShrink: 0 }}
          onError={() => setFaviconError(true)}
        />
      )}

      {/* Title */}
      <a
        href={bookmark.url}
        target="_blank"
        rel="noreferrer"
        style={{
          fontSize: 13,
          fontWeight: 600,
          color: "var(--text)",
          textDecoration: "none",
          whiteSpace: "nowrap",
          overflow: "hidden",
          textOverflow: "ellipsis",
          width: colWidths.title,
          flexShrink: 0,
        }}
      >
        {bookmark.title}
      </a>

      {/* URL */}
      <span style={{
        fontSize: 12, color: "var(--text-3)",
        whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
        width: colWidths.url, flexShrink: 0, textAlign: "left",
      }}>
        {bookmark.url.replace(/^https?:\/\//, "").replace(/\/$/, "")}
      </span>

      {/* Description */}
      <span style={{
        fontSize: 12, color: "var(--text-2)",
        whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
        flex: 1, minWidth: 0, textAlign: "left",
      }}>
        {bookmark.description ?? ""}
      </span>

      {/* Tags */}
      <div style={{
        display: "flex", gap: 4, flexShrink: 0,
        flexWrap: "nowrap", width: colWidths.tags, overflow: "hidden",
        justifyContent: "flex-start",
      }}>
        {visibleTags(bookmark.tags).map((tag) => (
          <span
            key={tag}
            onClick={() => onTagClick(tag)}
            style={{
              fontSize: 11, padding: "2px 7px", borderRadius: 99,
              background: tagColor(tag) + "22", color: tagColor(tag),
              border: `1px solid ${tagColor(tag)}44`,
              cursor: "pointer", whiteSpace: "nowrap",
            }}
          >
            {tag}
          </span>
        ))}
      </div>

      {/* Date */}
      <span style={{
        fontSize: 11, color: "var(--text-3)",
        whiteSpace: "nowrap", flexShrink: 0, width: colWidths.added, textAlign: "right",
      }}>
        {parseLocalDate(bookmark.addedAt).toLocaleDateString("en-US", {
          month: "short", day: "numeric", year: "numeric",
        })}
      </span>

      {/* Hover actions */}
      {hovered && (
        <div style={{ display: "flex", gap: 4, flexShrink: 0, width: 52, justifyContent: "flex-end" }}>
          <RowActionBtn title="Edit" onClick={onEdit} icon="✎" />
          <RowActionBtn
            title={deleteConfirming ? "Confirm delete" : "Delete"}
            onClick={onDelete} icon="⌫" danger confirming={deleteConfirming}
          />
        </div>
      )}
      {!hovered && <div style={{ width: 52, flexShrink: 0 }} />}
    </div>
  );
}

function RowActionBtn({
  title, onClick, icon, danger = false, confirming = false,
}: {
  title: string;
  onClick: () => void;
  icon: string;
  danger?: boolean;
  confirming?: boolean;
}) {
  const [hov, setHov] = useState(false);
  return (
    <button
      title={title}
      onClick={(e) => { e.preventDefault(); onClick(); }}
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      style={{
        width: 24,
        height: 24,
        borderRadius: 5,
        border: confirming ? "1px solid #ef444466" : "none",
        background: confirming ? "#ef444422" : hov ? (danger ? "#ef444422" : "var(--border-hover)") : "var(--border)",
        color: confirming || (hov && danger) ? "#ef4444" : "var(--text-3)",
        fontSize: 13,
        cursor: "pointer",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        transition: "background 0.1s, color 0.1s",
      }}
    >
      {icon}
    </button>
  );
}

interface Props {
  bookmarks: Bookmark[];
  zoom: number;
  onTagClick: (tag: string) => void;
  onEdit: (b: Bookmark) => void;
  onDelete: (id: string) => void;
  onDragStartBookmark: (bookmarkId: string, e: React.DragEvent) => void;
  onDropBookmarkOnBookmark?: (draggedId: string, targetId: string) => void;
  showPreview: boolean;
  deleteConfirmId: string | null;
  groupByDate: boolean;
}

function parseLocalDate(dateStr: string): Date {
  const [year, month, day] = dateStr.split("-").map(Number);
  return new Date(year, month - 1, day);
}

function formatDateLabel(dateStr: string): string {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const d = parseLocalDate(dateStr);
  const diffDays = Math.round((today.getTime() - d.getTime()) / 86400000);
  if (diffDays === 0) return "Today";
  if (diffDays === 1) return "Yesterday";
  return d.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });
}

export default function ListView({ bookmarks, zoom, onTagClick, onEdit, onDelete, onDragStartBookmark, onDropBookmarkOnBookmark, showPreview, deleteConfirmId, groupByDate }: Props) {
  const [colWidths, setColWidths] = useState<ListColumnWidths>(loadColumnWidths);
  const [resizing, setResizing] = useState<{ key: ListColumnKey; startX: number; startWidth: number } | null>(null);

  useEffect(() => {
    localStorage.setItem(LIST_COL_WIDTHS_KEY, JSON.stringify(colWidths));
  }, [colWidths]);

  useEffect(() => {
    if (!resizing) return;

    const onMove = (e: MouseEvent) => {
      const delta = e.clientX - resizing.startX;
      const next = clampColumnWidth(resizing.key, resizing.startWidth + delta);
      setColWidths((prev) => (prev[resizing.key] === next ? prev : { ...prev, [resizing.key]: next }));
    };

    const onUp = () => setResizing(null);

    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    const oldCursor = document.body.style.cursor;
    const oldUserSelect = document.body.style.userSelect;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";

    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      document.body.style.cursor = oldCursor;
      document.body.style.userSelect = oldUserSelect;
    };
  }, [resizing]);

  const startResize = (key: ListColumnKey, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setResizing({
      key,
      startX: e.clientX,
      startWidth: colWidths[key],
    });
  };

  if (bookmarks.length === 0) return null;

  if (!groupByDate) {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 1 }}>
        <ListHeader showPreview={showPreview} zoom={zoom} colWidths={colWidths} onResizeStart={startResize} />
        {bookmarks.map((b) => (
          <ListRow
            key={b.id}
            bookmark={b}
            zoom={zoom}
            colWidths={colWidths}
            onTagClick={onTagClick}
            onEdit={() => onEdit(b)}
            onDelete={() => onDelete(b.id)}
            onDragStartBookmark={onDragStartBookmark}
            onDropBookmarkOnBookmark={onDropBookmarkOnBookmark}
            showPreview={showPreview}
            deleteConfirming={deleteConfirmId === b.id}
          />
        ))}
      </div>
    );
  }

  // Grouped by date
  const groups = bookmarks.reduce<Record<string, Bookmark[]>>((acc, b) => {
    if (!acc[b.addedAt]) acc[b.addedAt] = [];
    acc[b.addedAt].push(b);
    return acc;
  }, {});

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
      {Object.keys(groups).map((date) => (
        <section key={date}>
          <DateHeader date={date} count={groups[date].length} />
          <div style={{ display: "flex", flexDirection: "column", gap: 1 }}>
            <ListHeader showPreview={showPreview} zoom={zoom} colWidths={colWidths} onResizeStart={startResize} />
            {groups[date].map((b) => (
              <ListRow
                key={b.id}
                bookmark={b}
                zoom={zoom}
                colWidths={colWidths}
                onTagClick={onTagClick}
                onEdit={() => onEdit(b)}
                onDelete={() => onDelete(b.id)}
                onDragStartBookmark={onDragStartBookmark}
                onDropBookmarkOnBookmark={onDropBookmarkOnBookmark}
                showPreview={showPreview}
                deleteConfirming={deleteConfirmId === b.id}
              />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

function ListHeader({
  showPreview,
  zoom,
  colWidths,
  onResizeStart,
}: {
  showPreview: boolean;
  zoom: number;
  colWidths: ListColumnWidths;
  onResizeStart: (key: ListColumnKey, e: React.MouseEvent) => void;
}) {
  const zoomIndex = Math.min(THUMB_W.length - 1, Math.max(0, Math.round(zoom) - 1));
  const cell = (
    label: string,
    style?: React.CSSProperties,
    resizeKey?: ListColumnKey,
    resizeSide: "left" | "right" = "right",
    dividerSide?: "left" | "right"
  ) => (
    <span
      style={{
        position: "relative",
        fontSize: 11,
        fontWeight: 600,
        color: "var(--text-4)",
        textTransform: "uppercase",
        letterSpacing: "0.05em",
        textAlign: "left",
        ...(dividerSide
          ? {
              [dividerSide === "left" ? "borderLeft" : "borderRight"]: "1px solid color-mix(in srgb, var(--border-hover) 40%, transparent)",
              paddingLeft: dividerSide === "left" ? 10 : undefined,
              paddingRight: dividerSide === "right" ? 10 : undefined,
            }
          : {}),
        ...style,
      }}
    >
      {label}
      {resizeKey && (
        <span
          onMouseDown={(e) => onResizeStart(resizeKey, e)}
          title={`Resize ${label.toLowerCase()} column`}
          style={{
            position: "absolute",
            top: -6,
            [resizeSide === "right" ? "right" : "left"]: -8,
            width: 16,
            height: 26,
            cursor: "col-resize",
            background: "transparent",
          }}
        />
      )}
    </span>
  );
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "4px 12px 6px", borderBottom: "1px solid #2c2c2e", marginBottom: 2 }}>
      {showPreview && <span style={{ width: THUMB_W[zoomIndex], flexShrink: 0 }} />}
      <span style={{ width: 18, flexShrink: 0 }} />
      {cell("Title",       { width: colWidths.title, flexShrink: 0 }, "title", "right")}
      {cell("URL",         { width: colWidths.url, flexShrink: 0 }, "url", "right", "left")}
      {cell("Description", { flex: 1, minWidth: 0 }, undefined, "right", "left")}
      {cell("Tags",        { width: colWidths.tags, flexShrink: 0 }, "tags", "left", "left")}
      {cell("Added",       { width: colWidths.added, textAlign: "right", flexShrink: 0 }, "added", "left", "left")}
      <span style={{ width: 52, flexShrink: 0 }} />
    </div>
  );
}

export function DateHeader({ date, count }: { date: string; count: number }) {
  return (
    <div
      style={{
        position: "sticky",
        top: 0,
        zIndex: 10,
        display: "flex",
        alignItems: "center",
        gap: 12,
        padding: "6px 0",
        marginBottom: 8,
        background: "var(--bg)",
      }}
    >
      <span style={{ fontSize: 13, fontWeight: 700, color: "var(--text-2)", whiteSpace: "nowrap" }}>
        {formatDateLabel(date)}
      </span>
      <div style={{ flex: 1, height: 1, background: "var(--border)" }} />
      <span style={{ fontSize: 11, color: "var(--text-4)", whiteSpace: "nowrap" }}>
        {count} bookmark{count !== 1 ? "s" : ""}
      </span>
    </div>
  );
}
