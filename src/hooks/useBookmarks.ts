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
    if (raw) return normaliseBookmarks(JSON.parse(raw));
  } catch {}
  return normaliseBookmarks(MOCK_BOOKMARKS);
}

function save(bookmarks: Bookmark[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(normaliseBookmarks(bookmarks)));
}

function loadCustomTags(): string[] {
  try {
    const raw = localStorage.getItem(CUSTOM_TAGS_KEY);
    if (raw) return JSON.parse(raw);
  } catch {}
  return [];
}

function saveCustomTags(tags: string[]) {
  localStorage.setItem(CUSTOM_TAGS_KEY, JSON.stringify(tags));
}

function normaliseKeywords(keywords?: string[]): string[] | undefined {
  if (!Array.isArray(keywords)) return undefined;
  const cleaned = Array.from(
    new Set(
      keywords
        .map((k) => String(k ?? "").trim().toLowerCase())
        .filter(Boolean)
    )
  );
  return cleaned.length > 0 ? cleaned : undefined;
}

function normaliseBookmarks(items: Bookmark[]): Bookmark[] {
  return items.map((b) => ({
    ...b,
    keywords: normaliseKeywords(b.keywords),
    addedAt: clampDateKeyToToday(b.addedAt),
  }));
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
      (b) => (!b.description?.trim() || !b.keywords?.length) && !enrichedIds.current.has(b.id)
    );
    if (missing.length === 0) return;

    // Mark before fetching so concurrent effect runs don't double-queue
    missing.forEach((b) => enrichedIds.current.add(b.id));

    (async () => {
      for (const bookmark of missing) {
        const meta = await fetchMeta(bookmark.url);
        const nextDescription = meta.description?.trim();
        const nextKeywords = normaliseKeywords(meta.keywords);
        if (!nextDescription && !meta.favicon && !nextKeywords?.length) continue;

        const current = load();
        const updated = current.map((b) =>
          b.id === bookmark.id
            ? {
                ...b,
                description: nextDescription || b.description,
                keywords: nextKeywords?.length ? nextKeywords : b.keywords,
                favicon: meta.favicon || b.favicon,
              }
            : b
        );
        save(updated);
        setBookmarks([...updated]);
      }
    })();
  }, [bookmarks]); // eslint-disable-line react-hooks/exhaustive-deps

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

  return { bookmarks, customTags, addBookmark, updateBookmark, removeBookmark, importBookmarks, renameTag, deleteTag, addTag, replaceBookmarks, replaceCustomTags, patchBookmark, allTags };
}
