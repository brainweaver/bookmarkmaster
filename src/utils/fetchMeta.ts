import { getYoutubeVideoId } from "./preview";

// Fetches page metadata (title, description, favicon) directly from a URL.
// Extension pages have <all_urls> host permission so cross-origin fetch works.
export async function fetchMeta(
  url: string
): Promise<{ title?: string; description?: string; favicon?: string; keywords?: string[] }> {
  const clean = (text?: string | null) =>
    (text ?? "")
      .replace(/[\u200B-\u200D\u2060\uFEFF]/g, "")
      .replace(/\s+/g, " ")
      .trim();

  // YouTube pages often return generic metadata when fetched without cookies.
  // Prefer oEmbed for stable, video-specific title/channel info.
  const youtubeId = getYoutubeVideoId(url);
  if (youtubeId) {
    const canonical = `https://www.youtube.com/watch?v=${youtubeId}`;
    const endpoints = [
      `https://www.youtube.com/oembed?url=${encodeURIComponent(canonical)}&format=json`,
      `https://noembed.com/embed?url=${encodeURIComponent(canonical)}`,
    ];
    for (const endpoint of endpoints) {
      try {
        const res = await fetch(endpoint, {
          signal: AbortSignal.timeout(8000),
          credentials: "omit",
        });
        if (!res.ok) continue;
        const data = await res.json() as {
          title?: string;
          author_name?: string;
          provider_name?: string;
        };
        const title = clean(data.title);
        const author = clean(data.author_name);
        const provider = clean(data.provider_name) || "YouTube";
        const description =
          author && title
            ? `${provider} video by ${author}`
            : author
              ? `${provider} video by ${author}`
              : `${provider} video`;
        if (title) {
          return {
            title,
            description,
            favicon: "https://www.youtube.com/favicon.ico",
            keywords: ["youtube", "video"],
          };
        }
      } catch {
        // Fall through to normal metadata scraping
      }
    }
  }

  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(8000),
      // Avoid sending cookies — we only want public metadata
      credentials: "omit",
    });
    if (!res.ok) return {};

    const html = await res.text();
    const doc = new DOMParser().parseFromString(html, "text/html");

    const title =
      clean(doc.querySelector('meta[property="og:title"]')?.getAttribute("content")) ||
      clean(doc.querySelector("title")?.textContent) ||
      "";

    const firstParagraph = clean(doc.querySelector("p")?.textContent);
    const description =
      clean(doc.querySelector('meta[property="og:description"]')?.getAttribute("content")) ||
      clean(doc.querySelector('meta[name="description"]')?.getAttribute("content")) ||
      clean(doc.querySelector('meta[name="twitter:description"]')?.getAttribute("content")) ||
      (firstParagraph.length >= 24 ? firstParagraph : "");

    const rawKeywords =
      clean(doc.querySelector('meta[name="keywords"]')?.getAttribute("content")) ||
      clean(doc.querySelector('meta[name="news_keywords"]')?.getAttribute("content")) ||
      clean(doc.querySelector('meta[property="article:tag"]')?.getAttribute("content")) ||
      "";

    const keywords = Array.from(
      new Set(
        rawKeywords
          .split(/[;,]/)
          .map((k) => clean(k).toLowerCase())
          .filter(Boolean)
      )
    );

    const faviconHref =
      doc.querySelector('link[rel~="icon"]')?.getAttribute("href") ||
      "/favicon.ico";

    let favicon = "";
    try {
      favicon = new URL(faviconHref, url).href;
    } catch {
      favicon = new URL("/favicon.ico", url).href;
    }

    return { title, description, favicon, keywords };
  } catch {
    return {};
  }
}

export async function isReachable(url: string): Promise<boolean> {
  try {
    const head = await fetch(url, {
      method: "HEAD",
      signal: AbortSignal.timeout(8000),
      credentials: "omit",
    });
    if (head.ok) return true;
    // Some servers reject HEAD but allow GET.
    if (head.status !== 405 && head.status !== 501) return false;
  } catch {}

  try {
    const get = await fetch(url, {
      signal: AbortSignal.timeout(8000),
      credentials: "omit",
    });
    return get.ok;
  } catch {
    return false;
  }
}
