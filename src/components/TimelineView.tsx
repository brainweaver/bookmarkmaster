import type { Bookmark } from "../data/mockBookmarks";
import BookmarkCard from "./BookmarkCard";
import { DateHeader } from "./ListView";
import { SYSTEM_TAG_ARCHIVED } from "../constants/tags";

function gridColumnsFromZoom(zoom: number): number {
  const normalized = (Math.max(1, Math.min(5, zoom)) - 1) / 4;
  return Math.max(1, Math.min(5, Math.round(5 - normalized * 4)));
}

interface Props {
  bookmarks: Bookmark[];
  zoom: number;
  onTagClick: (tag: string) => void;
  onEdit: (b: Bookmark) => void;
  onDelete: (id: string) => void;
  onArchive: (id: string) => void;
  onDragStartBookmark: (bookmarkId: string, e: React.DragEvent) => void;
  onDropBookmarkOnBookmark?: (draggedId: string, targetId: string) => void;
  showPreview: boolean;
  groupByDate: boolean;
  deleteConfirmId: string | null;
  selectedBookmarkIds: string[];
}

export default function TimelineView({
  bookmarks, zoom, onTagClick, onEdit, onDelete, onArchive, onDragStartBookmark, onDropBookmarkOnBookmark, showPreview, groupByDate, deleteConfirmId, selectedBookmarkIds,
}: Props) {
  const columns = gridColumnsFromZoom(zoom);
  if (bookmarks.length === 0) return null;

  const renderGrid = (items: Bookmark[]) => (
    <div style={{ display: "grid", gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`, gap: 10 }}>
      {items.map((b) => (
        <BookmarkCard
          key={b.id}
          bookmark={b}
          zoom={zoom}
          onTagClick={onTagClick}
          onEdit={() => onEdit(b)}
          onDelete={() => onDelete(b.id)}
          onArchive={() => onArchive(b.id)}
          onDragStartBookmark={onDragStartBookmark}
          onDropBookmarkOnBookmark={onDropBookmarkOnBookmark}
          showPreview={showPreview}
          deleteConfirming={deleteConfirmId === b.id}
          archived={b.tags.includes(SYSTEM_TAG_ARCHIVED)}
          selected={selectedBookmarkIds.includes(b.id)}
        />
      ))}
    </div>
  );

  if (!groupByDate) {
    return renderGrid(bookmarks);
  }

  const groups = bookmarks.reduce<Record<string, Bookmark[]>>((acc, b) => {
    if (!acc[b.addedAt]) acc[b.addedAt] = [];
    acc[b.addedAt].push(b);
    return acc;
  }, {});

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 32 }}>
      {Object.keys(groups).map((date) => (
        <section key={date}>
          <DateHeader date={date} count={groups[date].length} />
          {renderGrid(groups[date])}
        </section>
      ))}
    </div>
  );
}
