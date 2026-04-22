import { useEffect, useState } from "react";
import type { Bookmark } from "../data/mockBookmarks";
import { visibleTags } from "../constants/tags";
import { previewCandidatesForLink } from "../utils/preview";
import { tagColor } from "../utils/tagColors";

interface Props {
  bookmark: Bookmark;
  zoom: number;
  onTagClick: (tag: string) => void;
  onEdit: () => void;
  onDelete: () => void;
  onDragStartBookmark: (bookmarkId: string, e: React.DragEvent) => void;
  onDropBookmarkOnBookmark?: (draggedId: string, targetId: string) => void;
  showPreview?: boolean;
  deleteConfirming?: boolean;
}

export default function BookmarkCard({
  bookmark,
  zoom,
  onTagClick,
  onEdit,
  onDelete,
  onDragStartBookmark,
  onDropBookmarkOnBookmark,
  showPreview = false,
  deleteConfirming = false,
}: Props) {
  const [faviconError, setFaviconError] = useState(false);
  const [previewError, setPreviewError] = useState(false);
  const [previewLoaded, setPreviewLoaded] = useState(false);
  const [previewIndex, setPreviewIndex] = useState(0);
  const [hovered, setHovered] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const previewSources = previewCandidatesForLink(bookmark.url);
  const previewSrc = previewSources[Math.min(previewIndex, Math.max(0, previewSources.length - 1))] || "";

  const faviconSize = 14 + zoom * 4;
  const titleSize = 11 + zoom * 2;
  const urlSize = 9 + zoom * 1.5;
  const tagSize = 8 + zoom * 1.2;
  const showUrl = zoom >= 2;
  const showDescription = !!bookmark.description?.trim();
  const bodyPad = showPreview ? `${8 + zoom * 2}px` : `${8 + zoom * 3}px`;
  const previewHeight = (82 + zoom * 34) * 1.4;
  const gridCardHeight = 124 + zoom * 22;
  const previewCardHeight = previewHeight + (120 + zoom * 18);
  const titleClampLines = showPreview ? 2 : 2;
  const descriptionClampLines = zoom >= 4 ? 3 : 2;
  const initial = bookmark.title[0]?.toUpperCase() ?? "?";

  useEffect(() => {
    let active = true;
    queueMicrotask(() => {
      if (!active) return;
      setPreviewError(false);
      setPreviewLoaded(false);
      setPreviewIndex(0);
    });
    return () => {
      active = false;
    };
  }, [bookmark.url]);

  return (
    <div
      style={{ position: "relative", width: "100%", minWidth: 0 }}
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
    >
      <a
        href={bookmark.url}
        target="_blank"
        rel="noreferrer"
        style={{
          display: "flex",
          flexDirection: "column",
          width: "100%",
          minWidth: 0,
          background: "var(--card)",
          borderRadius: 10,
          border: `1px solid ${dragOver ? "#3b82f6" : hovered ? "var(--border-hover)" : "var(--border)"}`,
          textDecoration: "none",
          color: "inherit",
          overflow: "hidden",
          transition: "border-color 0.15s, box-shadow 0.15s",
          boxShadow: hovered ? "0 4px 20px rgba(0,0,0,0.4)" : "none",
          cursor: "pointer",
          height: showPreview ? previewCardHeight : gridCardHeight,
        }}
      >
        {/* Preview image */}
        {showPreview && !previewError && (
          <div
            style={{
              width: "100%",
              height: previewHeight,
              minHeight: previewHeight,
              background: "var(--border)",
              overflow: "hidden",
              position: "relative",
              flexShrink: 0,
            }}
          >
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

        {/* Card body */}
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: zoom >= 3 ? 7 : 4,
            padding: bodyPad,
            flex: 1,
            minHeight: 0,
          }}
        >
          {/* Favicon + title */}
          <div style={{ display: "flex", alignItems: "flex-start", gap: 7, minWidth: 0 }}>
            {faviconError ? (
              <div
                style={{
                  width: faviconSize,
                  height: faviconSize,
                  borderRadius: 4,
                  background: "var(--border-hover)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: faviconSize * 0.55,
                  fontWeight: 600,
                  color: "var(--text-2)",
                  flexShrink: 0,
                  marginTop: 1,
                }}
              >
                {initial}
              </div>
            ) : (
              <img
                src={bookmark.favicon}
                alt=""
                width={faviconSize}
                height={faviconSize}
                style={{ borderRadius: 4, flexShrink: 0, objectFit: "contain", marginTop: 1 }}
                onError={() => setFaviconError(true)}
              />
            )}
            <span
              style={{
                fontSize: titleSize,
                fontWeight: 600,
                color: "var(--text)",
                lineHeight: 1.3,
                flex: 1,
                minWidth: 0,
                overflow: "hidden",
                display: "-webkit-box",
                WebkitLineClamp: titleClampLines,
                WebkitBoxOrient: "vertical",
              }}
            >
              {bookmark.title}
            </span>
          </div>

          {showUrl && (
            <span
              style={{
                fontSize: urlSize,
                color: "var(--text-3)",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {bookmark.url.replace(/^https?:\/\//, "").replace(/\/$/, "")}
            </span>
          )}

          {showDescription && (
            <span
              style={{
                fontSize: urlSize,
                color: "var(--text-4)",
                overflow: "hidden",
                textOverflow: "ellipsis",
                display: "-webkit-box",
                WebkitLineClamp: descriptionClampLines,
                WebkitBoxOrient: "vertical",
                lineHeight: 1.4,
                minHeight: `${descriptionClampLines * 1.4}em`,
              }}
            >
              {bookmark.description}
            </span>
          )}

          {!showDescription && (
            <span
              style={{
                fontSize: urlSize,
                color: "var(--text-4)",
                lineHeight: 1.4,
                minHeight: `${descriptionClampLines * 1.4}em`,
                opacity: 0.75,
                display: "block",
              }}
            >
              {" "}
            </span>
          )}

          <div style={{ display: "flex", flexWrap: "nowrap", gap: 4, overflow: "hidden", minHeight: 22 }}>
            {visibleTags(bookmark.tags).map((tag) => (
              <span
                key={tag}
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  onTagClick(tag);
                }}
                style={{
                  fontSize: tagSize,
                  padding: `${zoom <= 2 ? 2 : 3}px ${zoom <= 2 ? 5 : 7}px`,
                  borderRadius: 99,
                  background: tagColor(tag) + "22",
                  color: tagColor(tag),
                  border: `1px solid ${tagColor(tag)}44`,
                  cursor: "pointer",
                  whiteSpace: "nowrap",
                }}
              >
                {tag}
              </span>
            ))}
          </div>
        </div>
      </a>

      {/* Hover action buttons */}
      {hovered && (
        <div
          style={{
            position: "absolute",
            top: 6,
            right: 6,
            display: "flex",
            gap: 4,
            zIndex: 10,
          }}
        >
          <ActionBtn
            title="Edit"
            onClick={(e) => {
              e.preventDefault();
              onEdit();
            }}
            icon={
              <svg width="13" height="13" viewBox="0 0 16 16" fill="currentColor">
                <path d="M11.5 1.5a2.121 2.121 0 0 1 3 3L5 14H2v-3L11.5 1.5z" />
              </svg>
            }
          />
          <ActionBtn
            title={deleteConfirming ? "Click again to confirm" : "Delete"}
            onClick={(e) => {
              e.preventDefault();
              onDelete();
            }}
            danger
            confirming={deleteConfirming}
            icon={
              deleteConfirming ? (
                <svg width="13" height="13" viewBox="0 0 16 16" fill="currentColor">
                  <path d="M8 1a7 7 0 1 1 0 14A7 7 0 0 1 8 1zm0 1.5a5.5 5.5 0 1 0 0 11 5.5 5.5 0 0 0 0-11zM7 5h2v4H7V5zm0 5h2v2H7v-2z"/>
                </svg>
              ) : (
                <svg width="13" height="13" viewBox="0 0 16 16" fill="currentColor">
                  <path d="M6 2h4a1 1 0 0 1 1 1H5a1 1 0 0 1 1-1zM2 4h12v1H3l.75 9h8.5L13 5h-1V4H2v1h1L2 4zm4 3h1l.5 5H6.5L6 7zm3 0h1l-.5 5H8.5L9 7z" />
                </svg>
              )
            }
          />
        </div>
      )}
    </div>
  );
}

function ActionBtn({
  title,
  onClick,
  icon,
  danger = false,
  confirming = false,
}: {
  title: string;
  onClick: (e: React.MouseEvent) => void;
  icon: React.ReactNode;
  danger?: boolean;
  confirming?: boolean;
}) {
  const [hov, setHov] = useState(false);
  return (
    <button
      title={title}
      onClick={onClick}
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        width: 26,
        height: 26,
        borderRadius: 6,
        border: confirming ? "1px solid #ef444466" : "none",
        background: confirming
          ? "#ef444433"
          : hov
          ? danger
            ? "#ef444433"
            : "var(--border-hover)"
          : "rgba(28,28,30,0.85)",
        color: confirming || (hov && danger) ? "#ef4444" : "var(--text-2)",
        cursor: "pointer",
        backdropFilter: "blur(4px)",
        transition: "background 0.12s, color 0.12s",
      }}
    >
      {icon}
    </button>
  );
}
