import { useState, useCallback, useMemo, useEffect, useRef } from "react";
import { MOCK_BOOKMARKS } from "../data/mockBookmarks";
import type { Bookmark } from "../data/mockBookmarks";
import { fetchMeta } from "../utils/fetchMeta";
import { clampDateKeyToToday, localDateKey } from "../utils/date";
import { visibleTags } from "../constants/tags";

const STORAGE_KEY = "bookmarks_v1";
const CUSTOM_TAGS_KEY = "custom_tags_v1";

function load(): Bookmark[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Bookmark[];
      const normalized = normaliseBookmarks(parsed);
      // Persist migration/sanitization updates for previously saved data.
      if (JSON.stringify(parsed) !== JSON.stringify(normalized)) {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(normalized));
      }
      return normalized;
    }
  } catch {
    // Ignore malformed local storage; fall back to mock bookmarks.
  }
  return normaliseBookmarks(MOCK_BOOKMARKS);
}

function save(bookmarks: Bookmark[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(normaliseBookmarks(bookmarks)));
}

function loadCustomTags(): string[] {
  try {
    const raw = localStorage.getItem(CUSTOM_TAGS_KEY);
    if (raw) return JSON.parse(raw);
  } catch {
    // Ignore malformed custom tags storage and return an empty list.
  }
  return [];
}

function saveCustomTags(tags: string[]) {
  localStorage.setItem(CUSTOM_TAGS_KEY, JSON.stringify(tags));
}

function normaliseBookmarks(items: Bookmark[]): Bookmark[] {
  return items.reduce<Bookmark[]>((acc, b) => {
    const raw = b as Partial<Bookmark> & Record<string, unknown>;
    const id = String(raw.id ?? "").trim();
    const title = String(raw.title ?? "").trim();
    const url = String(raw.url ?? "").trim();
    const favicon = String(raw.favicon ?? "").trim();
    if (!id || !title || !url || !favicon) return acc;
    const rawTags = Array.isArray(raw.tags) ? raw.tags : [];
    acc.push({
      id,
      title,
      url,
      description: typeof raw.description === "string" ? raw.description : undefined,
      tags: Array.from(new Set(rawTags.map((t) => String(t)).filter(Boolean))),
      favicon,
      addedAt: clampDateKeyToToday(String(raw.addedAt ?? localDateKey())),
      ranking: typeof raw.ranking === "number" ? raw.ranking : undefined,
    });
    return acc;
  }, []);
}

function normaliseUrlForImportDedupe(rawUrl: string): string {
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

function normaliseImportedTitle(title: string, url: string): string {
  const trimmed = String(title ?? "").trim();
  if (!trimmed) return title;
  return /^www\./i.test(trimmed)
    ? trimmed.replace(/^www\./i, "") || (() => {
        try { return new URL(url).hostname.replace(/^www\./i, ""); } catch { return trimmed; }
      })()
    : trimmed;
}

function isYoutubeUrl(url: string): boolean {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return host === "youtube.com" || host.endsWith(".youtube.com") || host === "youtu.be" || host.endsWith(".youtu.be");
  } catch {
    return false;
  }
}

function isGenericYoutubeTitle(title?: string): boolean {
  const t = String(title ?? "").trim();
  if (!t) return true;
  return /^-?\s*youtube$/i.test(t) || /\s-\s*YouTube$/i.test(t);
}

function isGenericYoutubeDescription(description?: string): boolean {
  const d = String(description ?? "").trim().toLowerCase();
  if (!d) return true;
  return d.includes("enjoy the videos and music you love");
}

function isHostnameLikeTitle(title: string, url: string): boolean {
  const normalizedTitle = title.trim().toLowerCase().replace(/^www\./, "").replace(/\/+$/, "");
  if (!normalizedTitle) return true;
  try {
    const host = new URL(url).hostname.toLowerCase().replace(/^www\./, "");
    return normalizedTitle === host;
  } catch {
    return false;
  }
}

export function useBookmarks() {
  const [bookmarks, setBookmarks] = useState<Bookmark[]>(load);
  const [customTags, setCustomTags] = useState<string[]>(loadCustomTags);
  // Tracks IDs already queued for enrichment so we never fetch the same bookmark twice
  const enrichedIds = useRef(new Set<string>());

  const commit = useCallback((next: Bookmark[]) => {
    const normalized = normaliseBookmarks(next);
    setBookmarks(normalized);
    save(normalized);
  }, []);

  // Background enrichment: whenever bookmarks change, find any without a description
  // that haven't been queued yet and fetch their metadata.
  // Runs automatically for bookmarks added on mount AND for newly imported ones.
  useEffect(() => {
    const missing = bookmarks.filter(
      (b) =>
        (
          !b.description?.trim() ||
          (isYoutubeUrl(b.url) && (isGenericYoutubeTitle(b.title) || isGenericYoutubeDescription(b.description)))
        ) &&
        !enrichedIds.current.has(b.id)
    );
    if (missing.length === 0) return;

    // Mark before fetching so concurrent effect runs don't double-queue
    missing.forEach((b) => enrichedIds.current.add(b.id));

    (async () => {
      for (const bookmark of missing) {
        const meta = await fetchMeta(bookmark.url);
        const shouldRefreshYoutube = isYoutubeUrl(bookmark.url) && (
          isGenericYoutubeTitle(bookmark.title) || isGenericYoutubeDescription(bookmark.description)
        );
        const shouldRefreshGenericTitle = isHostnameLikeTitle(bookmark.title, bookmark.url);
        const nextTitle = meta.title?.trim();
        const nextDescription = meta.description?.trim();
        if (!nextTitle && !nextDescription && !meta.favicon) continue;

        const current = load();
        const updated = current.map((b) =>
          b.id === bookmark.id
            ? {
                ...b,
                title: (shouldRefreshYoutube || shouldRefreshGenericTitle) && nextTitle ? nextTitle : b.title,
                description: nextDescription || b.description,
                favicon: meta.favicon || b.favicon,
              }
            : b
        );
        save(updated);
        setBookmarks([...updated]);
      }
    })();
  }, [bookmarks]);

  const addBookmark = useCallback(
    (data: Omit<Bookmark, "id" | "addedAt">) => {
      const next = load();
      const newBookmark: Bookmark = {
        ...data,
        id: crypto.randomUUID(),
        addedAt: localDateKey(),
      };
      commit([newBookmark, ...next]);
    },
    [commit]
  );

  const updateBookmark = useCallback(
    (id: string, data: Omit<Bookmark, "id" | "addedAt">) => {
      commit(bookmarks.map((b) => (b.id === id ? { ...b, ...data } : b)));
    },
    [bookmarks, commit]
  );

  const removeBookmark = useCallback(
    (id: string) => {
      commit(bookmarks.filter((b) => b.id !== id));
    },
    [bookmarks, commit]
  );

  const renameTag = useCallback(
    (oldName: string, newName: string) => {
      const trimmed = newName.trim().toLowerCase().replace(/\s+/g, "-");
      if (!trimmed || trimmed === oldName) return;
      commit(
        bookmarks.map((b) => ({
          ...b,
          tags: b.tags.map((t) => (t === oldName ? trimmed : t)),
        }))
      );
      setCustomTags((prev) => {
        if (!prev.includes(oldName)) return prev;
        if (prev.includes(trimmed)) {
          const deduped = prev.filter((t) => t !== oldName);
          saveCustomTags(deduped);
          return deduped;
        }
        const next = prev.map((t) => (t === oldName ? trimmed : t)).sort();
        saveCustomTags(next);
        return next;
      });
    },
    [bookmarks, commit]
  );

  const deleteTag = useCallback(
    (name: string) => {
      commit(bookmarks.map((b) => ({ ...b, tags: b.tags.filter((t) => t !== name) })));
      setCustomTags((prev) => {
        if (!prev.includes(name)) return prev;
        const next = prev.filter((t) => t !== name);
        saveCustomTags(next);
        return next;
      });
    },
    [bookmarks, commit]
  );

  const clearTag = useCallback(
    (name: string) => {
      commit(bookmarks.map((b) => ({ ...b, tags: b.tags.filter((t) => t !== name) })));
    },
    [bookmarks, commit]
  );

  const importBookmarks = useCallback(
    (items: Omit<Bookmark, "id">[]) => {
      const current = load();
      const existingUrls = new Set(current.map((b) => normaliseUrlForImportDedupe(b.url)));
      const seen = new Set<string>();
      const fresh: Bookmark[] = [];
      for (const item of items) {
        const key = normaliseUrlForImportDedupe(item.url);
        if (!key || existingUrls.has(key) || seen.has(key)) continue;
        seen.add(key);
        fresh.push({
          ...item,
          title: normaliseImportedTitle(item.title, item.url),
          id: crypto.randomUUID(),
        });
      }
      if (fresh.length === 0) return;
      commit([...fresh, ...current]);
    },
    [commit]
  );

  const addTag = useCallback((name: string) => {
    const trimmed = name.trim().toLowerCase().replace(/\s+/g, "-");
    if (!trimmed) return;
    setCustomTags((prev) => {
      if (prev.includes(trimmed)) return prev;
      const next = [...prev, trimmed].sort();
      saveCustomTags(next);
      return next;
    });
  }, []);



  const replaceCustomTags = useCallback((next: string[]) => {
    const normalized = Array.from(
      new Set(
        next
          .map((t) => t.trim().toLowerCase().replace(/\s+/g, "-"))
          .filter(Boolean)
      )
    ).sort();
    setCustomTags(normalized);
    saveCustomTags(normalized);
  }, []);

  const allTags = useMemo(
    () => Array.from(new Set([...bookmarks.flatMap((b) => visibleTags(b.tags)), ...customTags])).sort(),
    [bookmarks, customTags]
  );

  const replaceBookmarks = useCallback((next: Bookmark[]) => {
    commit(next);
  }, [commit]);

  // Always reads from localStorage first so concurrent updates don't overwrite each other
  const patchBookmark = useCallback((id: string, updates: Partial<Omit<Bookmark, "id">>) => {
    const current = load();
    const next = current.map((b) => b.id === id ? { ...b, ...updates } : b);
    save(next);
    setBookmarks([...next]);
  }, []);

  return { bookmarks, customTags, addBookmark, updateBookmark, removeBookmark, importBookmarks, renameTag, deleteTag, clearTag, addTag, replaceBookmarks, replaceCustomTags, patchBookmark, allTags };
}
