export interface Bookmark {
  id: string;
  title: string;
  url: string;
  description?: string;
  keywords?: string[];
  tags: string[];
  favicon: string;
  addedAt: string;
  ranking?: number; // higher = sorted first when using ranking sort
}

export const MOCK_BOOKMARKS: Bookmark[] = [
  // Today
  {
    id: "1",
    title: "GitHub",
    url: "https://github.com",
    tags: ["dashboard", "dev", "code"],
    favicon: "https://github.com/favicon.ico",
    addedAt: "2026-04-20",
  },
  {
    id: "2",
    title: "Linear",
    url: "https://linear.app",
    tags: ["productivity", "work"],
    favicon: "https://linear.app/favicon.ico",
    addedAt: "2026-04-20",
  },
  {
    id: "3",
    title: "Vercel",
    url: "https://vercel.com",
    tags: ["dev", "hosting"],
    favicon: "https://vercel.com/favicon.ico",
    addedAt: "2026-04-20",
  },
  // Yesterday
  {
    id: "4",
    title: "Figma",
    url: "https://figma.com",
    tags: ["design", "work"],
    favicon: "https://static.figma.com/app/icon/1/favicon.ico",
    addedAt: "2026-04-19",
  },
  {
    id: "5",
    title: "Dribbble",
    url: "https://dribbble.com",
    tags: ["design", "inspiration"],
    favicon: "https://cdn.dribbble.com/assets/favicon-b38525134603b9513174ec887944bde1a869eb6cd414f4d640ee48ab2a15a26b.ico",
    addedAt: "2026-04-19",
  },
  // April 17
  {
    id: "6",
    title: "Hacker News",
    url: "https://news.ycombinator.com",
    tags: ["news", "dev"],
    favicon: "https://news.ycombinator.com/favicon.ico",
    addedAt: "2026-04-17",
  },
  {
    id: "7",
    title: "MDN Web Docs",
    url: "https://developer.mozilla.org",
    tags: ["dev", "reference"],
    favicon: "https://developer.mozilla.org/favicon.ico",
    addedAt: "2026-04-17",
  },
  {
    id: "8",
    title: "Tailwind CSS",
    url: "https://tailwindcss.com",
    tags: ["dev", "css", "reference"],
    favicon: "https://tailwindcss.com/favicons/favicon-32x32.png",
    addedAt: "2026-04-17",
  },
  // April 14
  {
    id: "9",
    title: "Notion",
    url: "https://notion.so",
    tags: ["productivity", "work"],
    favicon: "https://notion.so/favicon.ico",
    addedAt: "2026-04-14",
  },
  {
    id: "10",
    title: "Stack Overflow",
    url: "https://stackoverflow.com",
    tags: ["dev", "reference"],
    favicon: "https://stackoverflow.com/favicon.ico",
    addedAt: "2026-04-14",
  },
  // April 10
  {
    id: "11",
    title: "YouTube",
    url: "https://youtube.com",
    tags: ["media", "entertainment"],
    favicon: "https://youtube.com/favicon.ico",
    addedAt: "2026-04-10",
  },
  {
    id: "12",
    title: "Spotify",
    url: "https://open.spotify.com",
    tags: ["media", "entertainment"],
    favicon: "https://open.spotify.com/favicon.ico",
    addedAt: "2026-04-10",
  },
  // April 5
  {
    id: "13",
    title: "Anthropic",
    url: "https://anthropic.com",
    tags: ["ai", "reference"],
    favicon: "https://anthropic.com/favicon.ico",
    addedAt: "2026-04-05",
  },
  {
    id: "14",
    title: "Hugging Face",
    url: "https://huggingface.co",
    tags: ["ai", "dev"],
    favicon: "https://huggingface.co/favicon.ico",
    addedAt: "2026-04-05",
  },
  {
    id: "15",
    title: "Arc Browser",
    url: "https://arc.net",
    tags: ["tools", "productivity"],
    favicon: "https://arc.net/favicon.ico",
    addedAt: "2026-04-05",
  },
  // March 28
  {
    id: "16",
    title: "Raycast",
    url: "https://raycast.com",
    tags: ["tools", "productivity"],
    favicon: "https://raycast.com/favicon.ico",
    addedAt: "2026-03-28",
  },
  {
    id: "17",
    title: "Excalidraw",
    url: "https://excalidraw.com",
    tags: ["design", "tools"],
    favicon: "https://excalidraw.com/favicon.ico",
    addedAt: "2026-03-28",
  },
];

export const ALL_TAGS = Array.from(
  new Set(MOCK_BOOKMARKS.flatMap((b) => b.tags))
).sort();
