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
