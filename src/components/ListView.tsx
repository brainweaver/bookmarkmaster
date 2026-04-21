import { useState } from "react";
import type { Bookmark } from "../data/mockBookmarks";
import { tagColor } from "./BookmarkCard";
import { visibleTags } from "../constants/tags";

function previewUrl(url: string) {
  return `/api/screenshot?url=${encodeURIComponent(url)}`;
}

const THUMB_W = [52,  92, 164, 292, 520];
const THUMB_H = [33,  58, 104, 184, 328];

interface RowProps {
  bookmark: Bookmark;
  zoom: number;
  onTagClick: (tag: string) => void;
  onEdit: () => void;
  onDelete: () => void;
  onDragStartBookmark: (bookmarkId: string, e: React.DragEvent) => void;
  showPreview: boolean;
  deleteConfirming: boolean;
}

function ListRow({ bookmark, zoom, onTagClick, onEdit, onDelete, onDragStartBookmark, showPreview, deleteConfirming }: RowProps) {
  const [hovered, setHovered] = useState(false);
  const [previewLoaded, setPreviewLoaded] = useState(false);
  const [previewError, setPreviewError] = useState(false);
  const [faviconError, setFaviconError] = useState(false);
  const initial = bookmark.title[0]?.toUpperCase() ?? "?";
  const zoomIndex = Math.min(THUMB_W.length - 1, Math.max(0, Math.round(zoom) - 1));

  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      draggable
      onDragStart={(e) => onDragStartBookmark(bookmark.id, e)}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: "7px 12px",
        background: hovered ? "var(--card)" : "transparent",
        borderRadius: 8,
        transition: "background 0.1s",
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
            src={previewUrl(bookmark.url)}
            alt=""
            onLoad={() => setPreviewLoaded(true)}
            onError={() => setPreviewError(true)}
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
          width: 180,
          flexShrink: 0,
        }}
      >
        {bookmark.title}
      </a>

      {/* URL */}
      <span style={{
        fontSize: 12, color: "var(--text-3)",
        whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
        width: 160, flexShrink: 0, textAlign: "left",
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
        flexWrap: "nowrap", width: 180, overflow: "hidden",
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
        whiteSpace: "nowrap", flexShrink: 0, width: 80, textAlign: "right",
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

export default function ListView({ bookmarks, zoom, onTagClick, onEdit, onDelete, onDragStartBookmark, showPreview, deleteConfirmId, groupByDate }: Props) {
  if (bookmarks.length === 0) return null;

  if (!groupByDate) {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 1 }}>
        <ListHeader showPreview={showPreview} zoom={zoom} />
        {bookmarks.map((b) => (
          <ListRow
            key={b.id}
            bookmark={b}
            zoom={zoom}
            onTagClick={onTagClick}
            onEdit={() => onEdit(b)}
            onDelete={() => onDelete(b.id)}
            onDragStartBookmark={onDragStartBookmark}
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
            <ListHeader showPreview={showPreview} zoom={zoom} />
            {groups[date].map((b) => (
              <ListRow
                key={b.id}
                bookmark={b}
                zoom={zoom}
                onTagClick={onTagClick}
                onEdit={() => onEdit(b)}
                onDelete={() => onDelete(b.id)}
                onDragStartBookmark={onDragStartBookmark}
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

function ListHeader({ showPreview, zoom }: { showPreview: boolean; zoom: number }) {
  const zoomIndex = Math.min(THUMB_W.length - 1, Math.max(0, Math.round(zoom) - 1));
  const cell = (label: string, style?: React.CSSProperties) => (
    <span style={{ fontSize: 11, fontWeight: 600, color: "var(--text-4)", textTransform: "uppercase", letterSpacing: "0.05em", textAlign: "left", ...style }}>
      {label}
    </span>
  );
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "4px 12px 6px", borderBottom: "1px solid #2c2c2e", marginBottom: 2 }}>
      {showPreview && <span style={{ width: THUMB_W[zoomIndex], flexShrink: 0 }} />}
      <span style={{ width: 18, flexShrink: 0 }} />
      {cell("Title",       { width: 180, flexShrink: 0 })}
      {cell("URL",         { width: 160, flexShrink: 0 })}
      {cell("Description", { flex: 1, minWidth: 0 })}
      {cell("Tags",        { width: 180, flexShrink: 0 })}
      {cell("Added",       { width: 80, textAlign: "right", flexShrink: 0 })}
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
