function isYoutubeHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  return host === "youtu.be" || host.endsWith(".youtu.be") || host === "youtube.com" || host.endsWith(".youtube.com");
}

const YT_ID_RE = /^[a-zA-Z0-9_-]{11}$/;

export function getYoutubeVideoId(url: string): string | null {
  try {
    const parsed = new URL(url);
    if (!isYoutubeHost(parsed.hostname)) return null;

    const host = parsed.hostname.toLowerCase();
    const segments = parsed.pathname.split("/").filter(Boolean);

    if (host.includes("youtu.be")) {
      const id = segments[0] ?? "";
      return YT_ID_RE.test(id) ? id : null;
    }

    const v = parsed.searchParams.get("v") ?? "";
    if (YT_ID_RE.test(v)) return v;

    const candidates = [segments[1], segments[0]];
    for (const candidate of candidates) {
      if (candidate && YT_ID_RE.test(candidate)) return candidate;
    }

    return null;
  } catch {
    // Fallback: parse raw strings that may not be valid URL objects.
    const m = url.match(/(?:youtu\.be\/|youtube\.com\/(?:shorts\/|embed\/|live\/|watch\?.*?v=))([a-zA-Z0-9_-]{11})/i);
    return m?.[1] ?? null;
  }
}

function youtubePreviewCandidates(videoId: string): string[] {
  return [
    `https://i.ytimg.com/vi/${videoId}/maxresdefault.jpg`,
    `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
    `https://i.ytimg.com/vi/${videoId}/mqdefault.jpg`,
    `https://i.ytimg.com/vi/${videoId}/default.jpg`,
  ];
}

export function previewCandidatesForLink(url: string): string[] {
  const youtubeId = getYoutubeVideoId(url);
  const screenshot = `/api/screenshot?url=${encodeURIComponent(url)}`;
  const fallback = `https://s.wordpress.com/mshots/v1/${encodeURIComponent(url)}?w=900`;
  if (youtubeId) return [...youtubePreviewCandidates(youtubeId), screenshot, fallback];
  return [screenshot, fallback];
}

export function previewUrlForLink(url: string): string {
  return previewCandidatesForLink(url)[0];
}
