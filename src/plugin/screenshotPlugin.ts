import type { Plugin, ViteDevServer } from "vite";
import type { IncomingMessage, ServerResponse } from "http";
import { createHash } from "crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync, statSync } from "fs";
import { join } from "path";

const CACHE_DIR = join(process.cwd(), ".screenshot-cache");
const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const CHROME_PATH = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

function cacheKey(prefix: string, url: string) {
  return createHash("md5").update(prefix + url).digest("hex");
}

function cacheFile(key: string, ext: string) {
  return join(CACHE_DIR, `${key}.${ext}`);
}

function isCacheValid(filePath: string) {
  try {
    return Date.now() - statSync(filePath).mtimeMs < CACHE_TTL_MS;
  } catch {
    return false;
  }
}

function parseUrl(raw: string | null): string | null {
  if (!raw) return null;
  try {
    const p = new URL(raw);
    if (!["http:", "https:"].includes(p.protocol)) return null;
    return p.toString();
  } catch {
    return null;
  }
}

function send(res: ServerResponse, status: number, contentType: string, body: Buffer | string) {
  res.writeHead(status, { "Content-Type": contentType, "Access-Control-Allow-Origin": "*" });
  res.end(body);
}

// ── Screenshot ────────────────────────────────────────────────────────────────

async function takeScreenshot(url: string): Promise<Buffer> {
  const { chromium } = await import("playwright-core");
  const browser = await chromium.launch({
    executablePath: CHROME_PATH,
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"],
  });
  try {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, userAgent: UA });
    const page = await ctx.newPage();
    await page.route("**/*", (r) =>
      ["media", "font"].includes(r.request().resourceType()) ? r.abort() : r.continue()
    );
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 15000 });
    await page.waitForTimeout(800);
    return await page.screenshot({ type: "jpeg", quality: 80 });
  } finally {
    await browser.close();
  }
}

// ── Meta (title + favicon) ────────────────────────────────────────────────────

interface PageMeta {
  title: string;
  favicon: string;
  description: string;
}

function extractMeta(html: string, origin: string): PageMeta {
  const tag = (pattern: RegExp) => (html.match(pattern)?.[1] ?? "").trim();

  const title =
    tag(/<meta[^>]+property="og:title"[^>]+content="([^"]+)"/i) ||
    tag(/<meta[^>]+content="([^"]+)"[^>]+property="og:title"/i) ||
    tag(/<title[^>]*>([^<]+)<\/title>/i) ||
    "";

  const description =
    tag(/<meta[^>]+property="og:description"[^>]+content="([^"]+)"/i) ||
    tag(/<meta[^>]+name="description"[^>]+content="([^"]+)"/i) ||
    tag(/<meta[^>]+content="([^"]+)"[^>]+name="description"/i) ||
    "";

  // Try link rel icon tags in priority order
  const iconHrefs: string[] = [];
  const linkRe = /<link[^>]+rel="([^"]*icon[^"]*)"[^>]+href="([^"]+)"/gi;
  let m: RegExpExecArray | null;
  while ((m = linkRe.exec(html)) !== null) iconHrefs.push(m[2]);
  // Also reversed attr order
  const linkRe2 = /<link[^>]+href="([^"]+)"[^>]+rel="([^"]*icon[^"]*)"/gi;
  while ((m = linkRe2.exec(html)) !== null) iconHrefs.push(m[1]);

  const rawFavicon = iconHrefs[0] ?? "/favicon.ico";
  const favicon = rawFavicon.startsWith("http") ? rawFavicon : `${origin}${rawFavicon.startsWith("/") ? "" : "/"}${rawFavicon}`;

  return { title, favicon, description };
}

async function fetchMeta(url: string): Promise<PageMeta> {
  const { origin } = new URL(url);
  const res = await fetch(url, {
    headers: { "User-Agent": UA, Accept: "text/html" },
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const html = await res.text();
  return extractMeta(html, origin);
}

// ── Vite plugin ───────────────────────────────────────────────────────────────

export function screenshotPlugin(): Plugin {
  return {
    name: "vite-screenshot-api",
    configureServer(server: ViteDevServer) {
      if (!existsSync(CACHE_DIR)) mkdirSync(CACHE_DIR, { recursive: true });

      // /api/screenshot?url=
      server.middlewares.use("/api/screenshot", async (req: IncomingMessage, res: ServerResponse) => {
        const targetUrl = parseUrl(new URL(req.url ?? "", "http://localhost").searchParams.get("url"));
        if (!targetUrl) return send(res, 400, "application/json", JSON.stringify({ error: "Invalid url" }));

        const key = cacheKey("shot", targetUrl);
        const cached = cacheFile(key, "jpg");
        if (isCacheValid(cached)) {
          return send(res, 200, "image/jpeg", readFileSync(cached));
        }
        try {
          const img = await takeScreenshot(targetUrl);
          writeFileSync(cached, img);
          send(res, 200, "image/jpeg", img);
        } catch (err) {
          console.error(`[screenshot]`, (err as Error).message);
          send(res, 500, "application/json", JSON.stringify({ error: "Screenshot failed" }));
        }
      });

      // /api/meta?url=
      server.middlewares.use("/api/meta", async (req: IncomingMessage, res: ServerResponse) => {
        const targetUrl = parseUrl(new URL(req.url ?? "", "http://localhost").searchParams.get("url"));
        if (!targetUrl) return send(res, 400, "application/json", JSON.stringify({ error: "Invalid url" }));

        const key = cacheKey("meta", targetUrl);
        const cached = cacheFile(key, "json");
        if (isCacheValid(cached)) {
          return send(res, 200, "application/json", readFileSync(cached));
        }
        try {
          const meta = await fetchMeta(targetUrl);
          const body = JSON.stringify(meta);
          writeFileSync(cached, body);
          send(res, 200, "application/json", body);
        } catch (err) {
          console.error(`[meta]`, (err as Error).message);
          // Fallback: derive what we can from the URL itself
          const { hostname } = new URL(targetUrl);
          const fallback: PageMeta = {
            title: hostname,
            favicon: `${new URL(targetUrl).origin}/favicon.ico`,
            description: "",
          };
          send(res, 200, "application/json", JSON.stringify(fallback));
        }
      });
    },
  };
}
