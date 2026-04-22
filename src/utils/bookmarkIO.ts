import type { Bookmark } from "../data/mockBookmarks";
import { clampDateKeyToToday, localDateKey, unixSecondsFromDateKey } from "./date";

// ── Chrome bookmark tree ──────────────────────────────────────────────────────

/** Recursively flatten the Chrome bookmark tree into leaf nodes (actual URLs). */
export function flattenChromeBookmarks(
  nodes: chrome.bookmarks.BookmarkTreeNode[]
): chrome.bookmarks.BookmarkTreeNode[] {
  const result: chrome.bookmarks.BookmarkTreeNode[] = [];
  function walk(node: chrome.bookmarks.BookmarkTreeNode) {
    if (node.url) result.push(node);
    node.children?.forEach(walk);
  }
  nodes.forEach(walk);
  return result;
}

/** Convert Chrome bookmark nodes to our Bookmark shape, skipping existing URLs. */
export function chromeNodesToBookmarks(
  nodes: chrome.bookmarks.BookmarkTreeNode[],
  existingUrls: Set<string>
): Omit<Bookmark, "id">[] {
  const seen = new Set<string>();
  const result: Omit<Bookmark, "id">[] = [];

  for (const n of nodes) {
    if (!n.url || existingUrls.has(n.url) || seen.has(n.url)) continue;
    seen.add(n.url);

    let hostname = "";
    try { hostname = new URL(n.url).hostname; } catch { continue; }

    result.push({
      title: n.title || hostname,
      url: n.url,
      description: undefined,
      tags: [],
      favicon: `https://www.google.com/s2/favicons?domain=${hostname}&sz=32`,
      addedAt: n.dateAdded
        ? clampDateKeyToToday(localDateKey(new Date(n.dateAdded)))
        : localDateKey(),
    });
  }
  return result;
}

// ── HTML (Netscape Bookmark File) ─────────────────────────────────────────────

/** Parse the standard Netscape HTML bookmark export format. */
export function parseHTMLBookmarks(
  html: string
): Array<{ title: string; url: string }> {
  const doc = new DOMParser().parseFromString(html, "text/html");
  return Array.from(doc.querySelectorAll("a[href]"))
    .map((a) => ({
      title: a.textContent?.trim() || (a as HTMLAnchorElement).hostname,
      url: (a as HTMLAnchorElement).href,
    }))
    .filter((b) => b.url.startsWith("http"));
}

/** Convert raw {title, url} pairs to our Bookmark shape, skipping existing URLs. */
export function rawToBookmarks(
  raw: Array<{
    title?: string;
    url: string;
    description?: string;
    tags?: string[];
    favicon?: string;
    addedAt?: string;
  }>,
  existingUrls: Set<string>
): Omit<Bookmark, "id">[] {
  const seen = new Set<string>();
  const result: Omit<Bookmark, "id">[] = [];
  const today = localDateKey();

  for (const r of raw) {
    if (!r.url || existingUrls.has(r.url) || seen.has(r.url)) continue;
    seen.add(r.url);

    let hostname = "";
    try { hostname = new URL(r.url).hostname; } catch { continue; }

    const cleanDescription = String(r.description ?? "").trim();
    const cleanTags = Array.isArray(r.tags)
      ? Array.from(new Set(r.tags.map((t) => String(t ?? "").trim().toLowerCase().replace(/\s+/g, "-")).filter(Boolean)))
      : [];
    const cleanFavicon = String(r.favicon ?? "").trim();

    result.push({
      title: String(r.title ?? "").trim() || hostname,
      url: r.url,
      description: cleanDescription || undefined,
      tags: cleanTags,
      favicon: cleanFavicon || `https://www.google.com/s2/favicons?domain=${hostname}&sz=32`,
      addedAt: clampDateKeyToToday(String(r.addedAt ?? today)),
    });
  }
  return result;
}

// ── Export ────────────────────────────────────────────────────────────────────

function esc(s: string) {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Generate a styled HTML page with a table view, also valid as a Netscape bookmark file. */
export function generateHTMLBookmarks(bookmarks: Bookmark[]): string {
  const rows = bookmarks.map((b) => {
    const ts = unixSecondsFromDateKey(clampDateKeyToToday(b.addedAt));
    const favicon = b.favicon ? `<img src="${esc(b.favicon)}" width="16" height="16" style="vertical-align:middle;border-radius:3px;margin-right:8px;" onerror="this.style.display='none'">` : "";
    const tags = b.tags.length ? b.tags.map((t) => `<span style="display:inline-block;padding:1px 7px;border-radius:99px;background:#3b82f620;color:#3b82f6;font-size:11px;border:1px solid #3b82f640;margin:1px 2px;">${esc(t)}</span>`).join("") : "";
    const desc = b.description ? `<div style="color:#94a3b8;font-size:12px;margin-top:3px;">${esc(b.description)}</div>` : "";
    return `
    <tr>
      <td style="padding:10px 14px;border-bottom:1px solid #1e293b;vertical-align:top;">
        ${favicon}<a href="${esc(b.url)}" style="color:#e2e8f0;font-weight:600;font-size:14px;text-decoration:none;" target="_blank">${esc(b.title)}</a>
        ${desc}
        <DT><A HREF="${esc(b.url)}" ADD_DATE="${ts}">${esc(b.title)}</A>
      </td>
      <td style="padding:10px 14px;border-bottom:1px solid #1e293b;color:#64748b;font-size:12px;vertical-align:top;white-space:nowrap;">${esc(b.addedAt)}</td>
      <td style="padding:10px 14px;border-bottom:1px solid #1e293b;vertical-align:top;">${tags}</td>
    </tr>`;
  }).join("\n");

  return `<!DOCTYPE NETSCAPE-Bookmark-file-1>
<META HTTP-EQUIV="Content-Type" CONTENT="text/html; charset=UTF-8">
<html>
<head>
  <title>Bookmarks</title>
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <style>
    body { margin: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #0f172a; color: #e2e8f0; }
    h1 { padding: 28px 32px 12px; margin: 0; font-size: 22px; color: #f8fafc; }
    .count { padding: 0 32px 20px; color: #64748b; font-size: 13px; }
    table { width: 100%; border-collapse: collapse; }
    thead th { padding: 8px 14px; text-align: left; font-size: 11px; font-weight: 700; color: #64748b; text-transform: uppercase; letter-spacing: .07em; border-bottom: 2px solid #1e293b; }
    tbody tr:hover td { background: #1e293b40; }
    a:hover { text-decoration: underline; }
  </style>
</head>
<body>
  <h1>Bookmarks</h1>
  <div class="count">${bookmarks.length} bookmark${bookmarks.length !== 1 ? "s" : ""}</div>
  <table>
    <thead>
      <tr>
        <th>Title</th>
        <th>Added</th>
        <th>Tags</th>
      </tr>
    </thead>
    <tbody>
${rows}
    </tbody>
  </table>
</body>
</html>`;
}
