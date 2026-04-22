import { getYoutubeVideoId } from "./preview";

// Fetches page metadata (title, description, favicon) directly from a URL.
// Extension pages have <all_urls> host permission so cross-origin fetch works.
export async function fetchMeta(
  url: string
): Promise<{ title?: string; description?: string; favicon?: string }> {
  const clean = (text?: string | null) =>
    (text ?? "")
      .replace(/[\u200B-\u200D\u2060\uFEFF]/g, "")
      .replace(/\s+/g, " ")
      .trim();

  const fallbackTitleFromUrl = (rawUrl: string): string => {
    try {
      const parsed = new URL(rawUrl);
      const host = parsed.hostname.replace(/^www\./i, "").toLowerCase();
      const firstPath = parsed.pathname.split("/").filter(Boolean)[0] ?? "";
      if (!firstPath) return host;
      const pathLabel = firstPath
        .replace(/[-_]+/g, " ")
        .replace(/\s+/g, " ")
        .trim();
      return pathLabel ? `${host} · ${pathLabel}` : host;
    } catch {
      return "";
    }
  };

  const fallbackDescriptionFromUrl = (rawUrl: string): string => {
    try {
      const parsed = new URL(rawUrl);
      const host = parsed.hostname.replace(/^www\./i, "").toLowerCase();
      return `Saved link from ${host}`;
    } catch {
      return "";
    }
  };

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
    if (!res.ok) {
      const title = fallbackTitleFromUrl(url);
      const description = fallbackDescriptionFromUrl(url);
      return { title, description };
    }

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

    const faviconHref =
      doc.querySelector('link[rel~="icon"]')?.getAttribute("href") ||
      "/favicon.ico";

    let favicon = "";
    try {
      favicon = new URL(faviconHref, url).href;
    } catch {
      favicon = new URL("/favicon.ico", url).href;
    }

    return {
      title: title || fallbackTitleFromUrl(url),
      description: description || fallbackDescriptionFromUrl(url),
      favicon,
    };
  } catch {
    const title = fallbackTitleFromUrl(url);
    const description = fallbackDescriptionFromUrl(url);
    return { title, description };
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
  } catch {
    // Network/DNS/CORS failures fall through to GET fallback.
  }

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
