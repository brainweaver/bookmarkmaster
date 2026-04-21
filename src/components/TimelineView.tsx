import type { Bookmark } from "../data/mockBookmarks";
import BookmarkCard from "./BookmarkCard";
import { DateHeader } from "./ListView";

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
  onDragStartBookmark: (bookmarkId: string, e: React.DragEvent) => void;
  showPreview: boolean;
  groupByDate: boolean;
  deleteConfirmId: string | null;
}

export default function TimelineView({
  bookmarks, zoom, onTagClick, onEdit, onDelete, onDragStartBookmark, showPreview, groupByDate, deleteConfirmId,
}: Props) {
  const columns = gridColumnsFromZoom(zoom);
  if (bookmarks.length === 0) return null;

  const renderGrid = (items: Bookmark[]) => (
    <div style={{ display: "grid", gridTemplateColumns: `repeat(${columns}, 1fr)`, gap: 10 }}>
      {items.map((b) => (
        <BookmarkCard
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
