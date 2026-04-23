import { useState, useMemo, useEffect, useRef } from "react";
import BookmarkCard from "./components/BookmarkCard";
import TimelineView from "./components/TimelineView";
import ListView from "./components/ListView";
import BookmarkModal from "./components/BookmarkModal";
import ImportExportModal from "./components/ImportExportModal";
import { cycleTagColor, tagColor } from "./utils/tagColors";
import { useBookmarks } from "./hooks/useBookmarks";
import { fetchMeta, resolveReachability } from "./utils/fetchMeta";
import { localDateKey } from "./utils/date";
import { SYSTEM_TAG_NOT_REACHABLE, SYSTEM_TAG_NOT_UNIQUE, visibleTags } from "./constants/tags";
import type { Bookmark } from "./data/mockBookmarks";
import { t } from "./i18n";
import {
  APP_CATALOG_KEY,
  APP_SHORTCUTS_KEY,
} from "./storage/keys";
import { persistenceGetItem, persistenceSetItem } from "./storage/persistence";
import {
  readCleanupBypassTagsPreference,
  readDisplayModePreference,
  readGroupByDatePreference,
  readRankOrderPreference,
  readSortByPreference,
  readTagOrderPreference,
  readThemePreference,
  readZoomPreference,
  sanitizeBackupPreferences,
  writeCleanupBypassTagsPreference,
  writeDisplayModePreference,
  writeGroupByDatePreference,
  writeRankOrderPreference,
  writeSortByPreference,
  writeTagOrderPreference,
  writeThemePreference,
  writeZoomPreference,
} from "./storage/preferences";

function gridColumnsFromZoom(zoom: number): number {
  const normalized = (Math.max(1, Math.min(5, zoom)) - 1) / 4;
  return Math.max(2, Math.min(8, Math.round(8 - normalized * 6)));
}
const NOT_TAGGED_FILTER = "__not_tagged__";
const NOT_UNIQUE_FILTER = SYSTEM_TAG_NOT_UNIQUE;
const NOT_REACHABLE_FILTER = SYSTEM_TAG_NOT_REACHABLE;
const BOOKMARK_DRAG_MIME = "application/x-bookmark-id";
const BOOKMARK_DRAG_FALLBACK_PREFIX = "bookmark:";
const TAG_DRAG_MIME = "application/x-sidebar-tag";
const APP_SHORTCUT_DRAG_MIME = "application/x-app-shortcut-id";
const APP_SHORTCUT_DRAG_FALLBACK_PREFIX = "app-shortcut:";

type AppShortcut = {
  id: string;
  name: string;
  url: string;
  icon: string;
  iconUrl?: string;
  group: string;
  custom?: boolean;
};

type AppGroup = {
  group: string;
  apps: AppShortcut[];
};

type AppEditorState =
  | { mode: "edit"; appId: string }
  | { mode: "icon"; appId: string };

const APP_UTILITIES_GROUP = "App Utilities";

function ensureUrlProtocol(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return "";
  return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
}

function domainFromUrl(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./i, "");
  } catch {
    return url;
  }
}

function faviconFromUrl(url: string): string {
  const domain = domainFromUrl(url);
  return `https://www.google.com/s2/favicons?domain=${domain}&sz=32`;
}

const LEGACY_ICON_OVERRIDE_VALUES = new Set<string>([
  "gmail",
  "gmail.svg",
  "/icons/gmail.svg",
  "https://cdn.simpleicons.org/googledrive/4285F4",
  "https://cdn.simpleicons.org/googlekeep/FFBB00",
  "https://cdn.simpleicons.org/googlecalendar/4285F4",
  "https://cdn.simpleicons.org/youtube/FF0000",
  "https://cdn.simpleicons.org/github/181717",
  "https://cdn.simpleicons.org/trello/0052CC",
  "https://cdn.simpleicons.org/perplexity/20B8A9",
  "https://cdn.simpleicons.org/openai/10A37F",
  "https://cdn.simpleicons.org/notion/000000",
  "https://cdn.simpleicons.org/linear/5E6AD2",
  "https://cdn.simpleicons.org/stackoverflow/F58025",
  "https://cdn.simpleicons.org/ycombinator/F0652F",
  "https://cdn.simpleicons.org/whatsapp/25D366",
  "https://cdn.simpleicons.org/facebook/1877F2",
  "https://cdn.simpleicons.org/x/000000",
  "https://cdn.simpleicons.org/reddit/FF4500",
]);

function sanitizeLegacyIconUrl(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return "";
  const normalized = /^(https?:)?\/\//i.test(trimmed) || trimmed.startsWith("/") || trimmed.startsWith("data:")
    ? trimmed
    : iconTokenToSrc(trimmed);
  if (LEGACY_ICON_OVERRIDE_VALUES.has(trimmed) || LEGACY_ICON_OVERRIDE_VALUES.has(normalized)) {
    return "";
  }
  return trimmed;
}

function presetApp(id: string, name: string, url: string, group: string, iconUrl?: string): AppShortcut {
  const normalizedUrl = ensureUrlProtocol(url);
  const normalizedIcon = (id === "figma" || id === "claude")
    ? undefined
    : (sanitizeLegacyIconUrl(iconUrl ?? "") || undefined);
  return {
    id,
    name,
    url: normalizedUrl,
    group,
    iconUrl: normalizedIcon,
    icon: faviconFromUrl(normalizedUrl),
  };
}

const DEFAULT_APP_GROUPS: AppGroup[] = [
  {
    group: "Social & Community",
    apps: [
      presetApp("youtube", "YouTube", "https://youtube.com", "Social & Community"),
      presetApp("x", "X", "https://x.com", "Social & Community"),
      presetApp("facebook", "Facebook", "https://facebook.com", "Social & Community"),
      presetApp("instagram", "Instagram", "https://instagram.com", "Social & Community"),
      presetApp("linkedin", "LinkedIn", "https://linkedin.com", "Social & Community"),
      presetApp("reddit", "Reddit", "https://reddit.com", "Social & Community"),
      presetApp("tiktok", "TikTok", "https://tiktok.com", "Social & Community"),
      presetApp("pinterest", "Pinterest", "https://pinterest.com", "Social & Community"),
      presetApp("snapchat", "Snapchat", "https://snapchat.com", "Social & Community"),
      presetApp("threads", "Threads", "https://threads.net", "Social & Community"),
      presetApp("discord", "Discord", "https://discord.com/app", "Social & Community"),
      presetApp("whatsapp", "WhatsApp", "https://web.whatsapp.com", "Social & Community"),
      presetApp("telegram", "Telegram", "https://web.telegram.org", "Social & Community"),
      presetApp("signal", "Signal", "https://signal.org", "Social & Community"),
    ],
  },
  {
    group: "Mail & Communication",
    apps: [
      presetApp("gmail", "Gmail", "https://mail.google.com", "Mail & Communication"),
      presetApp("yahoo-mail", "Yahoo Mail", "https://mail.yahoo.com", "Mail & Communication"),
      presetApp("outlook", "Outlook", "https://outlook.live.com/mail", "Mail & Communication"),
      presetApp("proton-mail", "Proton Mail", "https://mail.proton.me", "Mail & Communication"),
      presetApp("icloud-mail", "iCloud Mail", "https://icloud.com/mail", "Mail & Communication"),
      presetApp("slack", "Slack", "https://app.slack.com", "Mail & Communication"),
      presetApp("teams", "Microsoft Teams", "https://teams.microsoft.com", "Mail & Communication"),
      presetApp("zoom", "Zoom", "https://app.zoom.us", "Mail & Communication"),
      presetApp("google-meet", "Google Meet", "https://meet.google.com", "Mail & Communication"),
      presetApp("skype", "Skype", "https://web.skype.com", "Mail & Communication"),
    ],
  },
  {
    group: "Productivity",
    apps: [
      presetApp("google-calendar", "Google Calendar", "https://calendar.google.com", "Productivity"),
      presetApp("google-keep", "Google Keep", "https://keep.google.com", "Productivity"),
      presetApp("google-drive", "Google Drive", "https://drive.google.com", "Productivity"),
      presetApp("google-docs", "Google Docs", "https://docs.google.com", "Productivity"),
      presetApp("google-sheets", "Google Sheets", "https://sheets.google.com", "Productivity"),
      presetApp("google-slides", "Google Slides", "https://slides.google.com", "Productivity"),
      presetApp("notion", "Notion", "https://notion.so", "Productivity"),
      presetApp("trello", "Trello", "https://trello.com", "Productivity"),
      presetApp("asana", "Asana", "https://app.asana.com", "Productivity"),
      presetApp("clickup", "ClickUp", "https://app.clickup.com", "Productivity"),
      presetApp("airtable", "Airtable", "https://airtable.com", "Productivity"),
      presetApp("todoist", "Todoist", "https://todoist.com/app", "Productivity"),
      presetApp("evernote", "Evernote", "https://evernote.com", "Productivity"),
      presetApp("dropbox", "Dropbox", "https://dropbox.com", "Productivity"),
      presetApp("box", "Box", "https://box.com", "Productivity"),
      presetApp("onedrive", "OneDrive", "https://onedrive.live.com", "Productivity"),
    ],
  },
  {
    group: "Design & Media",
    apps: [
      presetApp("figma", "Figma", "https://figma.com", "Design & Media"),
      presetApp("canva", "Canva", "https://canva.com", "Design & Media"),
      presetApp("dribbble", "Dribbble", "https://dribbble.com", "Design & Media"),
      presetApp("behance", "Behance", "https://behance.net", "Design & Media"),
      presetApp("adobe-express", "Adobe Express", "https://express.adobe.com", "Design & Media"),
      presetApp("medium", "Medium", "https://medium.com", "Design & Media"),
      presetApp("substack", "Substack", "https://substack.com", "Design & Media"),
      presetApp("spotify", "Spotify", "https://open.spotify.com", "Design & Media"),
      presetApp("soundcloud", "SoundCloud", "https://soundcloud.com", "Design & Media"),
      presetApp("netflix", "Netflix", "https://netflix.com", "Design & Media"),
      presetApp("hulu", "Hulu", "https://hulu.com", "Design & Media"),
      presetApp("twitch", "Twitch", "https://twitch.tv", "Design & Media"),
    ],
  },
  {
    group: "Development",
    apps: [
      presetApp("github", "GitHub", "https://github.com", "Development"),
      presetApp("gitlab", "GitLab", "https://gitlab.com", "Development"),
      presetApp("bitbucket", "Bitbucket", "https://bitbucket.org", "Development"),
      presetApp("stack-overflow", "Stack Overflow", "https://stackoverflow.com", "Development"),
      presetApp("mdn", "MDN", "https://developer.mozilla.org", "Development"),
      presetApp("vercel", "Vercel", "https://vercel.com", "Development"),
      presetApp("netlify", "Netlify", "https://app.netlify.com", "Development"),
      presetApp("cloudflare", "Cloudflare", "https://dash.cloudflare.com", "Development"),
      presetApp("aws", "AWS", "https://console.aws.amazon.com", "Development"),
      presetApp("gcp", "Google Cloud", "https://console.cloud.google.com", "Development"),
      presetApp("azure", "Azure", "https://portal.azure.com", "Development"),
      presetApp("docker-hub", "Docker Hub", "https://hub.docker.com", "Development"),
      presetApp("npm", "npm", "https://npmjs.com", "Development"),
      presetApp("replit", "Replit", "https://replit.com", "Development"),
      presetApp("codepen", "CodePen", "https://codepen.io", "Development"),
      presetApp("visual-studio-code", "Visual Studio Code", "https://code.visualstudio.com", "Development"),
      presetApp("linear", "Linear", "https://linear.app", "Development"),
      presetApp("jira", "Jira", "https://atlassian.com/software/jira", "Development"),
      presetApp("postman", "Postman", "https://web.postman.co", "Development"),
      presetApp("sentry", "Sentry", "https://sentry.io", "Development"),
      presetApp("grafana", "Grafana", "https://grafana.com", "Development"),
    ],
  },
  {
    group: "AI Tools",
    apps: [
      presetApp("chatgpt", "ChatGPT", "https://chatgpt.com", "AI Tools"),
      presetApp("claude", "Claude", "https://claude.ai", "AI Tools"),
      presetApp("gemini", "Gemini", "https://gemini.google.com", "AI Tools"),
      presetApp("perplexity", "Perplexity", "https://perplexity.ai", "AI Tools"),
      presetApp("huggingface", "Hugging Face", "https://huggingface.co", "AI Tools"),
      presetApp("poe", "Poe", "https://poe.com", "AI Tools"),
      presetApp("notebooklm", "NotebookLM", "https://notebooklm.google", "AI Tools"),
      presetApp("cursor", "Cursor", "https://cursor.com", "AI Tools"),
      presetApp("abacus-ai", "Abacus.AI", "https://abacus.ai", "AI Tools"),
    ],
  },
];

const EXTRA_APP_GROUPS: AppGroup[] = [
  {
    group: "News & Reading",
    apps: [
      presetApp("google-news", "Google News", "https://news.google.com", "News & Reading"),
      presetApp("apple-news", "Apple News", "https://apple.news", "News & Reading"),
      presetApp("flipboard", "Flipboard", "https://flipboard.com", "News & Reading"),
      presetApp("hacker-news", "Hacker News", "https://news.ycombinator.com", "News & Reading"),
      presetApp("feedly", "Feedly", "https://feedly.com", "News & Reading"),
      presetApp("nytimes", "NYTimes", "https://nytimes.com", "News & Reading"),
      presetApp("wsj", "WSJ", "https://wsj.com", "News & Reading"),
      presetApp("bbc", "BBC", "https://bbc.com", "News & Reading"),
      presetApp("the-guardian", "The Guardian", "https://theguardian.com", "News & Reading"),
      presetApp("reuters", "Reuters", "https://reuters.com", "News & Reading"),
      presetApp("bloomberg", "Bloomberg", "https://bloomberg.com", "News & Reading"),
      presetApp("techcrunch", "TechCrunch", "https://techcrunch.com", "News & Reading"),
    ],
  },
  {
    group: "Shopping & Marketplaces",
    apps: [
      presetApp("amazon", "Amazon", "https://amazon.com", "Shopping & Marketplaces"),
      presetApp("ebay", "eBay", "https://ebay.com", "Shopping & Marketplaces"),
      presetApp("walmart", "Walmart", "https://walmart.com", "Shopping & Marketplaces"),
      presetApp("target", "Target", "https://target.com", "Shopping & Marketplaces"),
      presetApp("etsy", "Etsy", "https://etsy.com", "Shopping & Marketplaces"),
      presetApp("bestbuy", "Best Buy", "https://bestbuy.com", "Shopping & Marketplaces"),
      presetApp("aliexpress", "AliExpress", "https://aliexpress.com", "Shopping & Marketplaces"),
      presetApp("shopify", "Shopify", "https://shopify.com", "Shopping & Marketplaces"),
      presetApp("costco", "Costco", "https://costco.com", "Shopping & Marketplaces"),
      presetApp("newegg", "Newegg", "https://newegg.com", "Shopping & Marketplaces"),
      presetApp("wayfair", "Wayfair", "https://wayfair.com", "Shopping & Marketplaces"),
      presetApp("mercari", "Mercari", "https://mercari.com", "Shopping & Marketplaces"),
    ],
  },
  {
    group: "Finance & Banking",
    apps: [
      presetApp("paypal", "PayPal", "https://paypal.com", "Finance & Banking"),
      presetApp("stripe", "Stripe", "https://dashboard.stripe.com", "Finance & Banking"),
      presetApp("wise", "Wise", "https://wise.com", "Finance & Banking"),
      presetApp("venmo", "Venmo", "https://venmo.com", "Finance & Banking"),
      presetApp("cashapp", "Cash App", "https://cash.app", "Finance & Banking"),
      presetApp("robinhood", "Robinhood", "https://robinhood.com", "Finance & Banking"),
      presetApp("coinbase", "Coinbase", "https://coinbase.com", "Finance & Banking"),
      presetApp("binance", "Binance", "https://binance.com", "Finance & Banking"),
      presetApp("kraken", "Kraken", "https://kraken.com", "Finance & Banking"),
      presetApp("chase", "Chase", "https://chase.com", "Finance & Banking"),
      presetApp("bankofamerica", "Bank of America", "https://bankofamerica.com", "Finance & Banking"),
      presetApp("capitalone", "Capital One", "https://capitalone.com", "Finance & Banking"),
    ],
  },
  {
    group: "Learning & Docs",
    apps: [
      presetApp("wikipedia", "Wikipedia", "https://wikipedia.org", "Learning & Docs"),
      presetApp("coursera", "Coursera", "https://coursera.org", "Learning & Docs"),
      presetApp("udemy", "Udemy", "https://udemy.com", "Learning & Docs"),
      presetApp("khan-academy", "Khan Academy", "https://khanacademy.org", "Learning & Docs"),
      presetApp("duolingo", "Duolingo", "https://duolingo.com", "Learning & Docs"),
      presetApp("archive", "Internet Archive", "https://archive.org", "Learning & Docs"),
      presetApp("google-scholar", "Google Scholar", "https://scholar.google.com", "Learning & Docs"),
      presetApp("arxiv", "arXiv", "https://arxiv.org", "Learning & Docs"),
      presetApp("edx", "edX", "https://edx.org", "Learning & Docs"),
      presetApp("pluralsight", "Pluralsight", "https://pluralsight.com", "Learning & Docs"),
      presetApp("skillshare", "Skillshare", "https://skillshare.com", "Learning & Docs"),
      presetApp("readwise", "Readwise", "https://readwise.io", "Learning & Docs"),
    ],
  },
  {
    group: "App Utilities",
    apps: [
      presetApp("maps", "Google Maps", "https://maps.google.com", "App Utilities"),
      presetApp("translate", "Google Translate", "https://translate.google.com", "App Utilities"),
      presetApp("photos", "Google Photos", "https://photos.google.com", "App Utilities"),
      presetApp("weather", "Weather", "https://weather.com", "App Utilities"),
      presetApp("speedtest", "Speedtest", "https://speedtest.net", "App Utilities"),
      presetApp("cloud-convert", "CloudConvert", "https://cloudconvert.com", "App Utilities"),
      presetApp("wetransfer", "WeTransfer", "https://wetransfer.com", "App Utilities"),
      presetApp("calendly", "Calendly", "https://calendly.com", "App Utilities"),
      presetApp("bitly", "Bitly", "https://bitly.com", "App Utilities"),
      presetApp("tinyurl", "TinyURL", "https://tinyurl.com", "App Utilities"),
      presetApp("1password", "1Password", "https://1password.com", "App Utilities"),
      presetApp("lastpass", "LastPass", "https://lastpass.com", "App Utilities"),
      presetApp("bitwarden", "Bitwarden", "https://bitwarden.com", "App Utilities"),
      presetApp("dashlane", "Dashlane", "https://dashlane.com", "App Utilities"),
      presetApp("keeper", "Keeper", "https://keepersecurity.com", "App Utilities"),
      presetApp("nordpass", "NordPass", "https://nordpass.com", "App Utilities"),
      presetApp("proton-pass", "Proton Pass", "https://proton.me/pass", "App Utilities"),
      presetApp("roboform", "RoboForm", "https://roboform.com", "App Utilities"),
      presetApp("enpass", "Enpass", "https://enpass.io", "App Utilities"),
      presetApp("passbolt", "Passbolt", "https://passbolt.com", "App Utilities"),
      presetApp("keeper-commander", "Keeper Vault", "https://vault.keepersecurity.com", "App Utilities"),
      presetApp("bitwarden-vault", "Bitwarden Vault", "https://vault.bitwarden.com", "App Utilities"),
      presetApp("removebg", "remove.bg", "https://remove.bg", "App Utilities"),
      presetApp("temp-mail", "Temp Mail", "https://temp-mail.org", "App Utilities"),
      presetApp("generator-email", "10 Minute Mail", "https://10minutemail.com", "App Utilities"),
    ],
  },
  {
    group: "CRM & Sales",
    apps: [
      presetApp("salesforce", "Salesforce", "https://salesforce.com", "CRM & Sales"),
      presetApp("hubspot", "HubSpot", "https://hubspot.com", "CRM & Sales"),
      presetApp("pipedrive", "Pipedrive", "https://pipedrive.com", "CRM & Sales"),
      presetApp("zoho-crm", "Zoho CRM", "https://zoho.com/crm", "CRM & Sales"),
      presetApp("freshsales", "Freshsales", "https://freshworks.com/crm", "CRM & Sales"),
      presetApp("intercom", "Intercom", "https://intercom.com", "CRM & Sales"),
      presetApp("zendesk", "Zendesk", "https://zendesk.com", "CRM & Sales"),
      presetApp("gong", "Gong", "https://gong.io", "CRM & Sales"),
    ],
  },
  {
    group: "Marketing",
    apps: [
      presetApp("mailchimp", "Mailchimp", "https://mailchimp.com", "Marketing"),
      presetApp("convertkit", "ConvertKit", "https://convertkit.com", "Marketing"),
      presetApp("activecampaign", "ActiveCampaign", "https://activecampaign.com", "Marketing"),
      presetApp("klaviyo", "Klaviyo", "https://klaviyo.com", "Marketing"),
      presetApp("semrush", "Semrush", "https://semrush.com", "Marketing"),
      presetApp("ahrefs", "Ahrefs", "https://ahrefs.com", "Marketing"),
      presetApp("google-analytics", "Google Analytics", "https://analytics.google.com", "Marketing"),
      presetApp("google-ads", "Google Ads", "https://ads.google.com", "Marketing"),
      presetApp("meta-ads", "Meta Ads", "https://business.facebook.com", "Marketing"),
      presetApp("buffer", "Buffer", "https://buffer.com", "Marketing"),
      presetApp("hootsuite", "Hootsuite", "https://hootsuite.com", "Marketing"),
      presetApp("sprout-social", "Sprout Social", "https://sproutsocial.com", "Marketing"),
    ],
  },
  {
    group: "Data & BI",
    apps: [
      presetApp("tableau", "Tableau", "https://tableau.com", "Data & BI"),
      presetApp("power-bi", "Power BI", "https://powerbi.microsoft.com", "Data & BI"),
      presetApp("looker", "Looker", "https://looker.com", "Data & BI"),
      presetApp("metabase", "Metabase", "https://metabase.com", "Data & BI"),
      presetApp("mode", "Mode", "https://mode.com", "Data & BI"),
      presetApp("amplitude", "Amplitude", "https://amplitude.com", "Data & BI"),
      presetApp("mixpanel", "Mixpanel", "https://mixpanel.com", "Data & BI"),
      presetApp("segment", "Segment", "https://segment.com", "Data & BI"),
    ],
  },
  {
    group: "Cloud & DevOps",
    apps: [
      presetApp("kubernetes", "Kubernetes", "https://kubernetes.io", "Cloud & DevOps"),
      presetApp("digitalocean", "DigitalOcean", "https://digitalocean.com", "Cloud & DevOps"),
      presetApp("linode", "Linode", "https://linode.com", "Cloud & DevOps"),
      presetApp("render", "Render", "https://render.com", "Cloud & DevOps"),
      presetApp("railway", "Railway", "https://railway.app", "Cloud & DevOps"),
      presetApp("flyio", "Fly.io", "https://fly.io", "Cloud & DevOps"),
      presetApp("heroku", "Heroku", "https://heroku.com", "Cloud & DevOps"),
      presetApp("supabase", "Supabase", "https://supabase.com", "Cloud & DevOps"),
      presetApp("firebase", "Firebase", "https://firebase.google.com", "Cloud & DevOps"),
      presetApp("planet-scale", "PlanetScale", "https://planetscale.com", "Cloud & DevOps"),
      presetApp("mongodb-atlas", "MongoDB Atlas", "https://mongodb.com/atlas", "Cloud & DevOps"),
      presetApp("datadog", "Datadog", "https://datadoghq.com", "Cloud & DevOps"),
    ],
  },
  {
    group: "Code Hosting & CI",
    apps: [
      presetApp("github-actions", "GitHub Actions", "https://github.com/features/actions", "Code Hosting & CI"),
      presetApp("circleci", "CircleCI", "https://circleci.com", "Code Hosting & CI"),
      presetApp("travis", "Travis CI", "https://travis-ci.com", "Code Hosting & CI"),
      presetApp("jenkins", "Jenkins", "https://jenkins.io", "Code Hosting & CI"),
      presetApp("teamcity", "TeamCity", "https://jetbrains.com/teamcity", "Code Hosting & CI"),
      presetApp("buildkite", "Buildkite", "https://buildkite.com", "Code Hosting & CI"),
      presetApp("sonarqube", "SonarQube", "https://sonarqube.org", "Code Hosting & CI"),
      presetApp("codecov", "Codecov", "https://about.codecov.io", "Code Hosting & CI"),
    ],
  },
  {
    group: "Design & Product",
    apps: [
      presetApp("miro", "Miro", "https://miro.com", "Design & Product"),
      presetApp("whimsical", "Whimsical", "https://whimsical.com", "Design & Product"),
      presetApp("framer", "Framer", "https://framer.com", "Design & Product"),
      presetApp("invision", "InVision", "https://invisionapp.com", "Design & Product"),
      presetApp("zeplin", "Zeplin", "https://zeplin.io", "Design & Product"),
      presetApp("loom", "Loom", "https://loom.com", "Design & Product"),
      presetApp("mural", "Mural", "https://mural.co", "Design & Product"),
      presetApp("coda", "Coda", "https://coda.io", "Design & Product"),
    ],
  },
  {
    group: "Video & Streaming",
    apps: [
      presetApp("disney-plus", "Disney+", "https://disneyplus.com", "Video & Streaming"),
      presetApp("prime-video", "Prime Video", "https://primevideo.com", "Video & Streaming"),
      presetApp("max", "Max", "https://max.com", "Video & Streaming"),
      presetApp("peacock", "Peacock", "https://peacocktv.com", "Video & Streaming"),
      presetApp("paramount-plus", "Paramount+", "https://paramountplus.com", "Video & Streaming"),
      presetApp("apple-tv", "Apple TV+", "https://tv.apple.com", "Video & Streaming"),
      presetApp("vimeo", "Vimeo", "https://vimeo.com", "Video & Streaming"),
      presetApp("dailymotion", "Dailymotion", "https://dailymotion.com", "Video & Streaming"),
    ],
  },
  {
    group: "Music & Audio",
    apps: [
      presetApp("apple-music", "Apple Music", "https://music.apple.com", "Music & Audio"),
      presetApp("youtube-music", "YouTube Music", "https://music.youtube.com", "Music & Audio"),
      presetApp("pandora", "Pandora", "https://pandora.com", "Music & Audio"),
      presetApp("deezer", "Deezer", "https://deezer.com", "Music & Audio"),
      presetApp("tidal", "Tidal", "https://tidal.com", "Music & Audio"),
      presetApp("audible", "Audible", "https://audible.com", "Music & Audio"),
      presetApp("pocket-casts", "Pocket Casts", "https://pocketcasts.com", "Music & Audio"),
      presetApp("overcast", "Overcast", "https://overcast.fm", "Music & Audio"),
    ],
  },
  {
    group: "Travel & Local",
    apps: [
      presetApp("airbnb", "Airbnb", "https://airbnb.com", "Travel & Local"),
      presetApp("booking", "Booking.com", "https://booking.com", "Travel & Local"),
      presetApp("expedia", "Expedia", "https://expedia.com", "Travel & Local"),
      presetApp("tripadvisor", "Tripadvisor", "https://tripadvisor.com", "Travel & Local"),
      presetApp("uber", "Uber", "https://uber.com", "Travel & Local"),
      presetApp("lyft", "Lyft", "https://lyft.com", "Travel & Local"),
      presetApp("kayak", "Kayak", "https://kayak.com", "Travel & Local"),
      presetApp("skyscanner", "Skyscanner", "https://skyscanner.com", "Travel & Local"),
    ],
  },
  {
    group: "Food & Delivery",
    apps: [
      presetApp("doordash", "DoorDash", "https://doordash.com", "Food & Delivery"),
      presetApp("ubereats", "Uber Eats", "https://ubereats.com", "Food & Delivery"),
      presetApp("grubhub", "Grubhub", "https://grubhub.com", "Food & Delivery"),
      presetApp("instacart", "Instacart", "https://instacart.com", "Food & Delivery"),
      presetApp("opentable", "OpenTable", "https://opentable.com", "Food & Delivery"),
      presetApp("yelp", "Yelp", "https://yelp.com", "Food & Delivery"),
      presetApp("starbucks", "Starbucks", "https://starbucks.com", "Food & Delivery"),
      presetApp("mcdonalds", "McDonald's", "https://mcdonalds.com", "Food & Delivery"),
    ],
  },
  {
    group: "Health & Fitness",
    apps: [
      presetApp("fitbit", "Fitbit", "https://fitbit.com", "Health & Fitness"),
      presetApp("myfitnesspal", "MyFitnessPal", "https://myfitnesspal.com", "Health & Fitness"),
      presetApp("strava", "Strava", "https://strava.com", "Health & Fitness"),
      presetApp("peloton", "Peloton", "https://onepeloton.com", "Health & Fitness"),
      presetApp("headspace", "Headspace", "https://headspace.com", "Health & Fitness"),
      presetApp("calm", "Calm", "https://calm.com", "Health & Fitness"),
      presetApp("goodrx", "GoodRx", "https://goodrx.com", "Health & Fitness"),
      presetApp("zocdoc", "Zocdoc", "https://zocdoc.com", "Health & Fitness"),
    ],
  },
  {
    group: "Home & Smart",
    apps: [
      presetApp("google-home", "Google Home", "https://home.google.com", "Home & Smart"),
      presetApp("alexa", "Alexa", "https://alexa.amazon.com", "Home & Smart"),
      presetApp("philips-hue", "Philips Hue", "https://meethue.com", "Home & Smart"),
      presetApp("nest", "Nest", "https://store.google.com/category/nest", "Home & Smart"),
      presetApp("ring", "Ring", "https://ring.com", "Home & Smart"),
      presetApp("wyze", "Wyze", "https://wyze.com", "Home & Smart"),
      presetApp("ecobee", "ecobee", "https://ecobee.com", "Home & Smart"),
      presetApp("smartthings", "SmartThings", "https://smartthings.com", "Home & Smart"),
    ],
  },
  {
    group: "Gaming",
    apps: [
      presetApp("steam", "Steam", "https://store.steampowered.com", "Gaming"),
      presetApp("epic-games", "Epic Games", "https://store.epicgames.com", "Gaming"),
      presetApp("xbox", "Xbox", "https://xbox.com", "Gaming"),
      presetApp("playstation", "PlayStation", "https://playstation.com", "Gaming"),
      presetApp("nintendo", "Nintendo", "https://nintendo.com", "Gaming"),
      presetApp("battle-net", "Battle.net", "https://battle.net", "Gaming"),
      presetApp("ea", "EA", "https://ea.com", "Gaming"),
      presetApp("riot-games", "Riot Games", "https://riotgames.com", "Gaming"),
    ],
  },
];

const FULL_APP_GROUPS: AppGroup[] = [...DEFAULT_APP_GROUPS, ...EXTRA_APP_GROUPS];

const PRESET_APP_MAP = new Map(FULL_APP_GROUPS.flatMap((g) => g.apps.map((a) => [a.id, a] as const)));
const DEFAULT_APP_SHORTCUT_IDS = [
  "gmail",
  "google-drive",
  "google-calendar",
  "google-keep",
  "youtube",
  "whatsapp",
  "x",
  "facebook",
  "notion",
  "trello",
  "figma",
  "github",
  "linear",
  "chatgpt",
  "claude",
  "perplexity",
] as const;

function iconTokenToSrc(token: string): string {
  const trimmed = token.trim();
  if (!trimmed) return "";
  if (/^(https?:)?\/\//i.test(trimmed) || trimmed.startsWith("/") || trimmed.startsWith("data:")) {
    return trimmed;
  }
  const filename = /\.[a-z0-9]+$/i.test(trimmed) ? trimmed : `${trimmed}.png`;
  return `/icons/${filename}`;
}

function localAppIconCandidates(url: string): string[] {
  try {
    const host = new URL(url).hostname.toLowerCase().replace(/^www\./, "");
    if (!host) return [];
    const parts = host.split(".").filter(Boolean);
    const base = parts.length >= 2 ? parts.slice(-2).join(".") : host;
    const names = host === base ? [host] : [host, base];
    const exts = ["svg", "png", "webp", "jpg", "jpeg"];
    return names.flatMap((name) => exts.map((ext) => `/icons/apps/${name}.${ext}`));
  } catch {
    return [];
  }
}

function appIconCandidates(app: Pick<AppShortcut, "url" | "icon" | "iconUrl">): string[] {
  const local = localAppIconCandidates(app.url);
  const token = app.iconUrl?.trim();
  const tokenSrc = token ? iconTokenToSrc(token) : "";
  const candidates = [...local, tokenSrc, app.icon || "", faviconFromUrl(app.url)];
  return Array.from(new Set(candidates.filter(Boolean)));
}

function normaliseAppShortcut(item: Record<string, unknown>, fallbackGroup = "Custom"): AppShortcut | null {
  const url = ensureUrlProtocol(String(item.url ?? ""));
  if (!url) return null;
  const name = String(item.name ?? "").trim() || domainFromUrl(url);
  const icon = String(item.icon ?? "").trim() || faviconFromUrl(url);
  const id = String(item.id ?? `${item.custom ? "custom" : "app"}:${domainFromUrl(url)}`);
  const rawIconUrl = sanitizeLegacyIconUrl(String(item.iconUrl ?? ""));
  const iconUrl = (id === "figma" || id === "claude")
    ? undefined
    : (rawIconUrl || undefined);
  const group = canonicalAppGroupName(String(item.group ?? fallbackGroup));
  return { id, name, url, icon, iconUrl, group, custom: !!item.custom };
}

function canonicalAppGroupName(raw: string): string {
  const name = String(raw ?? "").trim() || "Custom";
  const key = name.toLowerCase();
  if (key === "utilities" || key === "password managers" || key === "app utilities") {
    return APP_UTILITIES_GROUP;
  }
  return name;
}

function collapseDuplicateAppGroups(groups: AppGroup[]): AppGroup[] {
  const mergedByName = new Map<string, AppGroup>();
  const seenByName = new Map<string, Set<string>>();
  const order: string[] = [];

  for (const group of groups) {
    const canonical = canonicalAppGroupName(group.group);
    if (!mergedByName.has(canonical)) {
      mergedByName.set(canonical, { group: canonical, apps: [] });
      seenByName.set(canonical, new Set());
      order.push(canonical);
    }
    const target = mergedByName.get(canonical)!;
    const seen = seenByName.get(canonical)!;
    for (const app of group.apps) {
      const dedupeKey = `${app.id}|${normaliseUrlForDedupe(app.url)}`;
      if (seen.has(dedupeKey)) continue;
      seen.add(dedupeKey);
      target.apps.push({ ...app, group: canonical });
    }
  }

  return order.map((name) => mergedByName.get(name)!);
}

function mergeCatalogWithDefaults(current: AppGroup[]): AppGroup[] {
  const merged = collapseDuplicateAppGroups(current).map((group) => ({
    group: group.group,
    apps: [...group.apps],
  }));

  const groupIndexByName = new Map(merged.map((g, i) => [g.group, i] as const));

  for (const defaults of FULL_APP_GROUPS) {
    const existingIndex = groupIndexByName.get(defaults.group);
    if (existingIndex === undefined) {
      merged.push({ group: defaults.group, apps: [...defaults.apps] });
      groupIndexByName.set(defaults.group, merged.length - 1);
      continue;
    }

    const existing = merged[existingIndex];
    const existingIds = new Set(existing.apps.map((a) => a.id));
    const existingUrls = new Set(existing.apps.map((a) => normaliseUrlForDedupe(a.url)));
    for (const app of defaults.apps) {
      const urlKey = normaliseUrlForDedupe(app.url);
      if (existingIds.has(app.id) || existingUrls.has(urlKey)) continue;
      existing.apps.push(app);
      existingIds.add(app.id);
      existingUrls.add(urlKey);
    }
  }

  return merged;
}

function loadAppCatalog(): AppGroup[] {
  try {
    const raw = persistenceGetItem(APP_CATALOG_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        const groups = parsed
          .filter((g) => !!g && typeof g === "object")
          .map((g) => {
            const obj = g as Record<string, unknown>;
            const groupName = canonicalAppGroupName(String(obj.group ?? "Custom"));
            const rawApps = Array.isArray(obj.apps) ? obj.apps : [];
            const apps = rawApps
              .filter((a) => !!a && typeof a === "object")
              .map((a) => normaliseAppShortcut(a as Record<string, unknown>, groupName))
              .filter((a): a is AppShortcut => a !== null);
            if (apps.length === 0) return null;
            return { group: groupName, apps } satisfies AppGroup;
          })
          .filter((g): g is AppGroup => g !== null);
        if (groups.length > 0) return mergeCatalogWithDefaults(groups);
      }
    }
  } catch {
    // Ignore malformed persisted app catalog and fall back to defaults.
  }
  return FULL_APP_GROUPS;
}

function loadAppShortcuts(): AppShortcut[] {
  try {
    const raw = persistenceGetItem(APP_SHORTCUTS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        const cleaned = parsed
          .filter((item) => !!item && typeof item === "object")
          .map((item) => normaliseAppShortcut(item as Record<string, unknown>, "Custom"))
          .filter((item): item is AppShortcut => item !== null);
        if (cleaned.length > 0) return cleaned;
      }
    }
  } catch {
    // Ignore malformed persisted app shortcuts and fall back to defaults.
  }

  return DEFAULT_APP_SHORTCUT_IDS
    .map((id) => PRESET_APP_MAP.get(id))
    .filter((item): item is AppShortcut => !!item);
}

type DisplayMode = "list" | "grid" | "preview";
type SortBy = "date" | "name" | "ranking";
type ModalState =
  | { mode: "closed" }
  | { mode: "add"; prefill?: { url: string; title: string; favicon: string; description?: string } }
  | { mode: "edit"; bookmark: Bookmark };


type BackupPreferences = {
  theme?: ThemeId;
  displayMode?: DisplayMode;
  groupByDate?: boolean;
  sortBy?: SortBy;
  rankOrder?: string[];
  zoom?: number;
  tagOrder?: string[];
  sidebarOpen?: boolean;
  appShortcuts?: AppShortcut[];
  appCatalog?: AppGroup[];
  cleanupBypassTags?: string[];
};

type BackupPayloadV2 = {
  version: 2;
  bookmarks: Bookmark[];
  customTags: string[];
  preferences: BackupPreferences;
};

const THEME_CYCLE = ["white", "gray", "red", "orange", "yellow", "green", "cyan", "blue", "purple", "pink", "brown", "white-mid", "gray-mid", "red-mid", "orange-mid", "yellow-mid", "green-mid", "cyan-mid", "blue-mid", "purple-mid", "pink-mid", "brown-mid", "black", "white-night", "gray-night", "red-night", "orange-night", "yellow-night", "green-night", "cyan-night", "blue-night", "purple-night", "pink-night", "brown-night", "dark", "midnight", "ocean", "dusk", "slate-night", "sapphire-night", "indigo-deep", "teal-night", "graphite", "high-contrast"] as const;
type ThemeId = typeof THEME_CYCLE[number];
const DARK_THEME_IDS = new Set<ThemeId>(["black", "white-night", "gray-night", "red-night", "orange-night", "yellow-night", "green-night", "cyan-night", "blue-night", "purple-night", "pink-night", "brown-night", "dark", "midnight", "ocean", "dusk", "slate-night", "sapphire-night", "indigo-deep", "teal-night", "graphite", "high-contrast"]);

function nextTheme(current: ThemeId): ThemeId {
  const idx = THEME_CYCLE.indexOf(current);
  return THEME_CYCLE[(idx + 1) % THEME_CYCLE.length];
}

function normaliseUrlForDedupe(rawUrl: string): string {
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

function similarBaseUrlKey(rawUrl: string): string {
  try {
    const u = new URL(rawUrl);
    const host = u.hostname.toLowerCase().replace(/^www\./, "");
    const segments = u.pathname.split("/").filter(Boolean);
    const firstSegment = segments[0]?.toLowerCase() ?? "";
    return firstSegment ? `${host}/${firstSegment}` : host;
  } catch {
    return rawUrl
      .trim()
      .toLowerCase()
      .replace(/^https?:\/\//, "")
      .replace(/^www\./, "")
      .split(/[/?#]/)[0] || rawUrl.trim().toLowerCase();
  }
}

function preferCanonicalUrl(a: string, b: string): string {
  if (a.startsWith("https://")) return a;
  if (b.startsWith("https://")) return b;
  return a;
}

function normaliseBookmarkTitle(title: string, url: string): string {
  const trimmed = String(title ?? "").trim();
  if (!/^www\./i.test(trimmed)) return trimmed;
  const withoutWww = trimmed.replace(/^www\./i, "").trim();
  if (withoutWww) return withoutWww;
  try {
    return new URL(url).hostname.replace(/^www\./i, "");
  } catch {
    return trimmed;
  }
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

function normalizeTagName(raw: string): string {
  return raw.trim().toLowerCase().replace(/\s+/g, "-");
}

function stripSystemTagsFromBookmarks(items: Bookmark[]): Bookmark[] {
  return items.map((b) => ({ ...b, tags: visibleTags(b.tags) }));
}

function loadTheme(): ThemeId {
  return readThemePreference(THEME_CYCLE, "ocean");
}

function loadDisplayMode(): DisplayMode {
  return readDisplayModePreference("list");
}

function loadGroupByDate(): boolean {
  return readGroupByDatePreference(true);
}

function loadSortBy(): SortBy {
  return readSortByPreference("date");
}

function loadZoom(): number {
  return readZoomPreference(3, 1, 5);
}

function loadRankOrder(): string[] {
  return readRankOrderPreference();
}

function loadTagOrder(): string[] {
  return readTagOrderPreference();
}

function loadCleanupBypassTags(): string[] {
  return readCleanupBypassTagsPreference();
}

export default function App() {
  const { bookmarks, customTags, addBookmark, updateBookmark, removeBookmark, importBookmarks, renameTag, deleteTag, clearTag, addTag, replaceBookmarks, replaceCustomTags, allTags } = useBookmarks();
  const [showImport, setShowImport] = useState(false);
  const [showExport, setShowExport] = useState(false);

  const [theme, setTheme] = useState<ThemeId>(loadTheme);
  const [displayMode, setDisplayMode] = useState<DisplayMode>(loadDisplayMode);
  const [groupByDate, setGroupByDate] = useState(loadGroupByDate);
  const [zoom, setZoom] = useState(loadZoom);

  const [selectedTag, setSelectedTag] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [sortBy, setSortBy] = useState<SortBy>(loadSortBy);
  const [rankOrder, setRankOrder] = useState<string[]>(loadRankOrder);
  const rankOrderHydratedRef = useRef(false);
  const [modal, setModal] = useState<ModalState>({ mode: "closed" });
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [newTagInput, setNewTagInput] = useState<string | null>(null);
  const newTagRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [dropLoading, setDropLoading] = useState(false);
  const [collapseTabsLoading, setCollapseTabsLoading] = useState(false);
  const [expandTabsLoading, setExpandTabsLoading] = useState(false);
  const [cleanupState, setCleanupState] = useState<{ running: boolean; progress: number; total: number }>({ running: false, progress: 0, total: 0 });
  const [cleanupResult, setCleanupResult] = useState<{ removed: number; missingFound: number; missingFixed: number; notUnique: number; notReachable: number } | null>(null);
  const [showDataMenu, setShowDataMenu] = useState(false);
  const dataMenuRef = useRef<HTMLDivElement>(null);
  const restoreFileRef = useRef<HTMLInputElement>(null);
  const [showDeleteAll, setShowDeleteAll] = useState(false);
  const [showClearAllTags, setShowClearAllTags] = useState(false);
  const [pendingTagDelete, setPendingTagDelete] = useState<string | null>(null);
  const [, setTagColorVersion] = useState(0);
  const [tagOrder, setTagOrder] = useState<string[]>(loadTagOrder);
  const [cleanupBypassTags, setCleanupBypassTags] = useState<string[]>(loadCleanupBypassTags);
  const [appCatalog, setAppCatalog] = useState<AppGroup[]>(loadAppCatalog);
  const [appShortcuts, setAppShortcuts] = useState<AppShortcut[]>(loadAppShortcuts);
  const [showAppPicker, setShowAppPicker] = useState(false);
  const [customAppName, setCustomAppName] = useState("");
  const [customAppUrl, setCustomAppUrl] = useState("");
  const [customAppIconUrl, setCustomAppIconUrl] = useState("");
  const [addingCustomApp, setAddingCustomApp] = useState(false);
  const [appEditor, setAppEditor] = useState<AppEditorState | null>(null);
  const [appEditorName, setAppEditorName] = useState("");
  const [appEditorUrl, setAppEditorUrl] = useState("");
  const [appEditorIconUrl, setAppEditorIconUrl] = useState("");
  const [appEditorError, setAppEditorError] = useState<string | null>(null);
  const [appContextMenu, setAppContextMenu] = useState<{ x: number; y: number; appId: string } | null>(null);
  const appContextMenuRef = useRef<HTMLDivElement>(null);
  const [appDraggingId, setAppDraggingId] = useState<string | null>(null);
  const [appDragReadyId, setAppDragReadyId] = useState<string | null>(null);
  const appDragHoverTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [appPickerError, setAppPickerError] = useState<string | null>(null);

  // When opened via extension toolbar click or context menu, URL params carry
  // the originating tab's info — auto-open the add modal with it prefilled.
  const effectiveSelectedTag =
    selectedTag === NOT_TAGGED_FILTER || selectedTag === NOT_UNIQUE_FILTER || selectedTag === NOT_REACHABLE_FILTER
      ? null
      : selectedTag;
  const orderedSidebarTags = useMemo(() => {
    const orderedExisting = tagOrder.filter((t) => allTags.includes(t));
    const remaining = allTags.filter((t) => !orderedExisting.includes(t));
    return [...orderedExisting, ...remaining];
  }, [allTags, tagOrder]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const from = params.get("from");
    if (!from) return;
    const tab = {
      url: from,
      title: params.get("title") ?? "",
      favicon: params.get("favicon") ?? "",
    };
    queueMicrotask(() => {
      setModal({ mode: "add", prefill: tab });
    });
    // Clean the URL so a refresh doesn't re-trigger
    window.history.replaceState({}, "", window.location.pathname);
  }, []);

  useEffect(() => {
    if (!showDataMenu) return;
    const handler = (e: MouseEvent) => {
      if (dataMenuRef.current && !dataMenuRef.current.contains(e.target as Node)) {
        setShowDataMenu(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [showDataMenu]);

  useEffect(() => {
    if (!appContextMenu) return;
    const closeOnOutsideClick = (e: MouseEvent) => {
      if (!appContextMenuRef.current) return;
      if (!appContextMenuRef.current.contains(e.target as Node)) {
        setAppContextMenu(null);
      }
    };
    const closeOnEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape") setAppContextMenu(null);
    };
    const closeOnResize = () => setAppContextMenu(null);
    const closeOnScroll = () => setAppContextMenu(null);
    window.addEventListener("click", closeOnOutsideClick);
    window.addEventListener("resize", closeOnResize);
    window.addEventListener("scroll", closeOnScroll, true);
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      window.removeEventListener("click", closeOnOutsideClick);
      window.removeEventListener("resize", closeOnResize);
      window.removeEventListener("scroll", closeOnScroll, true);
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [appContextMenu]);

  useEffect(() => {
    return () => {
      if (appDragHoverTimerRef.current) {
        clearTimeout(appDragHoverTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    writeThemePreference(theme);
  }, [theme]);

  useEffect(() => {
    writeDisplayModePreference(displayMode);
  }, [displayMode]);

  useEffect(() => {
    writeGroupByDatePreference(groupByDate);
  }, [groupByDate]);

  useEffect(() => {
    writeSortByPreference(sortBy);
  }, [sortBy]);

  useEffect(() => {
    writeRankOrderPreference(rankOrder);
  }, [rankOrder]);

  useEffect(() => {
    writeZoomPreference(zoom);
  }, [zoom]);

  useEffect(() => {
    writeTagOrderPreference(tagOrder);
  }, [tagOrder]);

  useEffect(() => {
    writeCleanupBypassTagsPreference(cleanupBypassTags);
  }, [cleanupBypassTags]);

  useEffect(() => {
    persistenceSetItem(APP_SHORTCUTS_KEY, JSON.stringify(appShortcuts));
  }, [appShortcuts]);

  useEffect(() => {
    persistenceSetItem(APP_CATALOG_KEY, JSON.stringify(appCatalog));
  }, [appCatalog]);

  useEffect(() => {
    if (rankOrderHydratedRef.current) return;
    rankOrderHydratedRef.current = true;
    if (rankOrder.length > 0) return;

    const rankedIds = [...bookmarks]
      .filter((b) => typeof b.ranking === "number")
      .sort((a, b) => (b.ranking ?? 0) - (a.ranking ?? 0))
      .map((b) => b.id);
    if (rankedIds.length === 0) return;
    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled) return;
      setRankOrder(rankedIds);
    });
    return () => {
      cancelled = true;
    };
  }, [bookmarks, rankOrder]);

  useEffect(() => {
    const bookmarkIds = bookmarks.map((b) => b.id);
    const bookmarkSet = new Set(bookmarkIds);
    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled) return;
      setRankOrder((prev) => {
        const next = prev.filter((id) => bookmarkSet.has(id));
        return next.length === prev.length ? prev : next;
      });
    });
    return () => {
      cancelled = true;
    };
  }, [bookmarks]);

  const filtered = useMemo(() => {
    const tokens = search.trim().toLowerCase().split(/\s+/).filter(Boolean);
    const tagTokens = tokens.filter((t) => t.startsWith("#")).map((t) => t.slice(1));
    const textTokens = tokens.filter((t) => !t.startsWith("#"));

    return bookmarks.filter((b) => {
      const userTags = visibleTags(b.tags);
      if (selectedTag === NOT_TAGGED_FILTER && userTags.length > 0) return false;
      if (selectedTag === NOT_UNIQUE_FILTER && !b.tags.includes(SYSTEM_TAG_NOT_UNIQUE)) return false;
      if (selectedTag === NOT_REACHABLE_FILTER && !b.tags.includes(SYSTEM_TAG_NOT_REACHABLE)) return false;
      if (effectiveSelectedTag && !b.tags.includes(effectiveSelectedTag)) return false;
      if (tagTokens.some((tag) => !userTags.includes(tag))) return false;
      if (textTokens.some((q) =>
        !b.title.toLowerCase().includes(q) &&
        !(b.description?.toLowerCase().includes(q)) &&
        !b.url.toLowerCase().includes(q) &&
        !userTags.some((t) => t.includes(q))
      )) return false;
      return true;
    });
  }, [bookmarks, selectedTag, effectiveSelectedTag, search]);

  const sorted = useMemo(() => {
    const arr = [...filtered];
    if (sortBy === "name") arr.sort((a, b) => a.title.localeCompare(b.title));
    else if (sortBy === "ranking") {
      const rankIdx = new Map(rankOrder.map((id, idx) => [id, idx]));
      arr.sort((a, b) => {
        const ai = rankIdx.get(a.id);
        const bi = rankIdx.get(b.id);
        if (ai !== undefined && bi !== undefined) return ai - bi;
        if (ai !== undefined) return -1;
        if (bi !== undefined) return 1;
        return 0;
      });
    }
    else arr.sort((a, b) => b.addedAt.localeCompare(a.addedAt));

    if (selectedTag === NOT_UNIQUE_FILTER) {
      arr.sort((a, b) => {
        const ka = similarBaseUrlKey(a.url);
        const kb = similarBaseUrlKey(b.url);
        if (ka !== kb) return ka.localeCompare(kb);
        return a.url.localeCompare(b.url);
      });
    }
    return arr;
  }, [filtered, sortBy, rankOrder, selectedTag]);

  // Date grouping only makes sense when sorted by date
  const effectiveGroupByDate = groupByDate && sortBy === "date";
  const cleanupPercent = cleanupState.running && cleanupState.total > 0
    ? Math.round((cleanupState.progress / cleanupState.total) * 100)
    : 0;

  const handleSave = (data: Omit<Bookmark, "id" | "addedAt">) => {
    if (modal.mode === "add") {
      const incomingKey = normaliseUrlForDedupe(data.url);
      const existing = bookmarks.find((b) => normaliseUrlForDedupe(b.url) === incomingKey);
      if (existing) {
        const confirmed = window.confirm(
          `A bookmark for this link already exists.\n\nTitle: ${existing.title}\nURL: ${existing.url}\n\nConfirm = overwrite existing bookmark\nCancel = keep existing bookmark`
        );
        if (!confirmed) return;
        updateBookmark(existing.id, {
          ...data,
          ranking: data.ranking ?? existing.ranking,
        });
      } else {
        addBookmark(data);
      }
    } else if (modal.mode === "edit") {
      updateBookmark(modal.bookmark.id, data);
    }
    setModal({ mode: "closed" });
  };

  const handleDelete = (id: string) => {
    if (deleteConfirm === id) {
      removeBookmark(id);
      setDeleteConfirm(null);
    } else {
      setDeleteConfirm(id);
      setTimeout(() => setDeleteConfirm(null), 3000);
    }
  };

  const columns = gridColumnsFromZoom(zoom);

  const handleDragOver = (e: React.DragEvent) => {
    if (e.dataTransfer.types.includes(BOOKMARK_DRAG_MIME) || e.dataTransfer.types.includes(TAG_DRAG_MIME)) return;
    e.preventDefault();
    setDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragging(false);
  };

  const [dropResult, setDropResult] = useState<string | null>(null);

  const handleDrop = async (e: React.DragEvent) => {
    if (e.dataTransfer.types.includes(BOOKMARK_DRAG_MIME) || e.dataTransfer.types.includes(TAG_DRAG_MIME)) {
      setDragging(false);
      return;
    }
    e.preventDefault();
    setDragging(false);
    const raw =
      e.dataTransfer.getData("text/uri-list") ||
      e.dataTransfer.getData("text/plain") ||
      "";
    const urls = Array.from(new Set(
      raw.split(/[\n\r]+/).map((s) => s.trim()).filter((s) => s.startsWith("http") && !s.startsWith("#"))
    ));
    if (urls.length === 0) return;
    const droppedTags =
      selectedTag && selectedTag !== NOT_TAGGED_FILTER && selectedTag !== NOT_UNIQUE_FILTER && selectedTag !== NOT_REACHABLE_FILTER
        ? [selectedTag]
        : [];

    setDropLoading(true);
    try {
      const items = await Promise.all(urls.map(async (url) => {
        const meta = await fetchMeta(url);
        let hostname = "";
        try { hostname = new URL(url).hostname; } catch { return null; }
        return {
          url,
          title: meta.title || hostname,
          description: meta.description || undefined,
          favicon: meta.favicon || `https://www.google.com/s2/favicons?domain=${hostname}&sz=32`,
          tags: droppedTags,
          addedAt: localDateKey(),
        };
      }));
      const valid = items.filter((x): x is NonNullable<typeof x> => x !== null);
      const byKey = new Map(bookmarks.map((b) => [normaliseUrlForDedupe(b.url), b] as const));
      const toImport: Omit<Bookmark, "id">[] = [];
      let overwritten = 0;

      for (const item of valid) {
        const key = normaliseUrlForDedupe(item.url);
        const existing = byKey.get(key);
        if (!existing) {
          toImport.push(item);
          continue;
        }

        const confirmed = window.confirm(
          `A bookmark for this link already exists.\n\nTitle: ${existing.title}\nURL: ${existing.url}\n\nConfirm = overwrite existing bookmark\nCancel = skip this dropped bookmark`
        );
        if (!confirmed) continue;

        updateBookmark(existing.id, {
          title: item.title,
          url: item.url,
          favicon: item.favicon,
          description: item.description,
          tags: item.tags,
          ranking: existing.ranking,
        });
        overwritten += 1;
      }

      if (toImport.length > 0) {
        importBookmarks(toImport);
      }

      const imported = toImport.length;
      if (imported > 0 || overwritten > 0) {
        const parts = [];
        if (imported > 0) parts.push(`Imported ${imported}`);
        if (overwritten > 0) parts.push(`overwrote ${overwritten}`);
        setDropResult(`${parts.join(" and ")} bookmark${imported + overwritten === 1 ? "" : "s"}`);
      } else {
        setDropResult("No bookmarks imported.");
      }
      setTimeout(() => setDropResult(null), 3000);
    } finally {
      setDropLoading(false);
    }
  };

  const handleCollapseTabs = async () => {
    if (collapseTabsLoading) return;
    setCollapseTabsLoading(true);
    try {
      const tabs = await chrome.tabs.query({ currentWindow: true });
      const activeTabId = tabs.find((tab) => tab.active)?.id;

      const tabsToCollapse = tabs.filter((tab) => {
        const url = tab.url ?? "";
        return (
          typeof tab.id === "number" &&
          tab.id !== activeTabId &&
          !!url &&
          !url.startsWith("chrome-extension://")
        );
      });

      if (tabsToCollapse.length === 0) {
        setDropResult("No tabs found to collapse in this window.");
        setTimeout(() => setDropResult(null), 3000);
        return;
      }

      const dedupedByUrl = new Map<string, chrome.tabs.Tab>();
      for (const tab of tabsToCollapse) {
        const url = tab.url ?? "";
        if (!url || dedupedByUrl.has(url)) continue;
        dedupedByUrl.set(url, tab);
      }

      const existingUrls = new Set(bookmarks.map((b) => b.url));
      const items: Omit<Bookmark, "id">[] = [];
      for (const tab of dedupedByUrl.values()) {
        const url = tab.url ?? "";
        if (!url || existingUrls.has(url)) continue;
        const isWeb = /^https?:\/\//i.test(url);
        let hostname = "";
        if (isWeb) {
          try { hostname = new URL(url).hostname; } catch {
            // Ignore invalid URLs for icon hostname fallback.
          }
        }
        items.push({
          url,
          title: tab.title?.trim() || hostname || url,
          description: undefined,
          favicon: isWeb
            ? (tab.favIconUrl || `https://www.google.com/s2/favicons?domain=${hostname}&sz=32`)
            : (tab.favIconUrl || ""),
          tags: [],
          addedAt: localDateKey(),
        });
      }

      if (items.length > 0) {
        importBookmarks(items);
      }

      const closableIds = tabsToCollapse
        .map((tab) => tab.id)
        .filter((id): id is number => typeof id === "number");
      if (closableIds.length > 0) {
        await chrome.tabs.remove(closableIds);
      }
      setDropResult(
        `Collapsed ${closableIds.length} tab${closableIds.length !== 1 ? "s" : ""} · imported ${items.length} new bookmark${items.length !== 1 ? "s" : ""}`
      );
      setTimeout(() => setDropResult(null), 4000);
    } catch {
      setDropResult("Could not collapse tabs right now.");
      setTimeout(() => setDropResult(null), 3000);
    } finally {
      setCollapseTabsLoading(false);
    }
  };

  const handleExpandTabs = async () => {
    if (expandTabsLoading) return;
    if (!selectedTag) {
      alert("Please select a tag first.");
      return;
    }

    const tagLabel =
      selectedTag === NOT_TAGGED_FILTER
        ? "Not Tagged"
        : selectedTag === NOT_REACHABLE_FILTER
        ? "Not Reachable"
        : selectedTag;

    // Open exactly what the user is currently seeing in the filtered view,
    // preserving visible order and exact URL text.
    const visibleUrls = sorted
      .map((b) => b.url)
      .filter((url) => /^https?:\/\//i.test(url));

    if (visibleUrls.length === 0) {
      setDropResult(`No links found for ${tagLabel}.`);
      setTimeout(() => setDropResult(null), 3000);
      return;
    }

    const toOpen = visibleUrls.slice(0, 30);
    const confirmed = window.confirm(
      `We are about to open ${toOpen.length.toLocaleString()} number of links from the ${tagLabel} tag. Continue or Cancel`
    );
    if (!confirmed) return;

    setExpandTabsLoading(true);
    try {
      for (const url of toOpen) {
        await chrome.tabs.create({ url, active: false });
      }
      setDropResult(`Opened ${toOpen.length.toLocaleString()} tab${toOpen.length !== 1 ? "s" : ""} from ${tagLabel}.`);
      setTimeout(() => setDropResult(null), 4000);
    } catch {
      setDropResult("Could not open tabs right now.");
      setTimeout(() => setDropResult(null), 3000);
    } finally {
      setExpandTabsLoading(false);
    }
  };

  const handleBookmarkDragStart = (bookmarkId: string, e: React.DragEvent) => {
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData(BOOKMARK_DRAG_MIME, bookmarkId);
    e.dataTransfer.setData("text/plain", `${BOOKMARK_DRAG_FALLBACK_PREFIX}${bookmarkId}`);
  };

  const getDraggedBookmarkId = (e: React.DragEvent): string => {
    const directId = e.dataTransfer.getData(BOOKMARK_DRAG_MIME);
    const plain = e.dataTransfer.getData("text/plain");
    const fallbackId = plain.startsWith(BOOKMARK_DRAG_FALLBACK_PREFIX)
      ? plain.slice(BOOKMARK_DRAG_FALLBACK_PREFIX.length)
      : "";
    return directId || fallbackId;
  };

  const handleBookmarkDropOnTag = (bookmarkId: string, tag: string) => {
    replaceBookmarks(
      bookmarks.map((b) => {
        if (b.id !== bookmarkId || b.tags.includes(tag)) return b;
        return { ...b, tags: [...b.tags, tag] };
      })
    );
  };

  const handleReorderBookmark = (draggedId: string, targetId: string) => {
    if (sortBy !== "ranking") {
      setDropResult("Switch to Ranking sort to reorder tiles.");
      setTimeout(() => setDropResult(null), 1800);
      return;
    }
    if (draggedId === targetId) return;
    const visibleOrder = sorted.map((b) => b.id);
    const visibleFrom = visibleOrder.indexOf(draggedId);
    const visibleTo = visibleOrder.indexOf(targetId);
    if (visibleFrom < 0 || visibleTo < 0) return;
    const placeAfter = visibleFrom < visibleTo;

    // Rebuild reorder state from a full list so moving one card never drops
    // ranking for unrelated cards.
    const rankIdx = new Map(rankOrder.map((id, idx) => [id, idx] as const));
    const fullOrder = [...bookmarks]
      .sort((a, b) => {
        const ai = rankIdx.get(a.id);
        const bi = rankIdx.get(b.id);
        if (ai !== undefined && bi !== undefined) return ai - bi;
        if (ai !== undefined) return -1;
        if (bi !== undefined) return 1;
        return (b.ranking ?? 0) - (a.ranking ?? 0);
      })
      .map((b) => b.id);

    const from = fullOrder.indexOf(draggedId);
    const target = fullOrder.indexOf(targetId);
    if (from < 0 || target < 0) return;

    const nextOrder = [...fullOrder];
    nextOrder.splice(from, 1);
    const adjustedTarget = target > from ? target - 1 : target;
    const insertIdx = Math.max(0, Math.min(nextOrder.length, adjustedTarget + (placeAfter ? 1 : 0)));
    nextOrder.splice(insertIdx, 0, draggedId);
    setRankOrder(nextOrder);

    const total = nextOrder.length;
    const rankingMap = new Map(nextOrder.map((id, idx) => [id, total - idx] as const));

    replaceBookmarks(
      bookmarks.map((b) => ({
        ...b,
        ranking: rankingMap.get(b.id),
      }))
    );
    setSortBy("ranking");
    setGroupByDate(false);
  };

  const handleReorderSidebarTag = (draggedTag: string, targetTag: string) => {
    if (draggedTag === targetTag) return;
    const next = [...orderedSidebarTags];
    const from = next.indexOf(draggedTag);
    const to = next.indexOf(targetTag);
    if (from < 0 || to < 0) return;
    next.splice(from, 1);
    next.splice(to, 0, draggedTag);
    setTagOrder(next);
  };

  const handleRenameSidebarTag = (oldName: string, newName: string) => {
    const normalized = normalizeTagName(newName);

    if (normalized && normalized !== oldName) {
      setTagOrder((prev) => {
        const hasOld = prev.includes(oldName);
        const hasNew = prev.includes(normalized);

        if (hasOld) {
          if (hasNew) {
            return prev.filter((t) => t !== oldName);
          }
          return prev.map((t) => (t === oldName ? normalized : t));
        }

        // Keep renamed tags in the same visual sidebar position even when
        // they were not previously pinned in tagOrder.
        const visual = [...orderedSidebarTags];
        const from = visual.indexOf(oldName);
        if (from < 0) return prev;
        const without = visual.filter((t) => t !== oldName && t !== normalized);
        const insertAt = Math.max(0, Math.min(from, without.length));
        without.splice(insertAt, 0, normalized);
        return without;
      });
    }

    if (normalized && normalized !== oldName) {
      setCleanupBypassTags((prev) => {
        if (!prev.includes(oldName)) return prev;
        if (prev.includes(normalized)) return prev.filter((t) => t !== oldName);
        return prev.map((t) => (t === oldName ? normalized : t));
      });
    }

    renameTag(oldName, newName);
  };

  const handleClearNotUnique = () => {
    replaceBookmarks(
      bookmarks.map((b) => ({
        ...b,
        tags: b.tags.filter((t) => t !== SYSTEM_TAG_NOT_UNIQUE),
      }))
    );
  };

  const handleClearNotReachable = () => {
    replaceBookmarks(
      bookmarks.map((b) => ({
        ...b,
        tags: b.tags.filter((t) => t !== SYSTEM_TAG_NOT_REACHABLE),
      }))
    );
  };

  const handleClearNotTagged = () => {
    const untaggedCount = bookmarks.filter((b) => visibleTags(b.tags).length === 0).length;
    if (untaggedCount === 0) return;
    if (!window.confirm(`Delete ${untaggedCount} untagged bookmarks?`)) return;
    replaceBookmarks(bookmarks.filter((b) => visibleTags(b.tags).length > 0));
    if (selectedTag === NOT_TAGGED_FILTER) setSelectedTag(null);
  };

  const addAppShortcut = (app: AppShortcut) => {
    setAppShortcuts((prev) => {
      const appKey = normaliseUrlForDedupe(app.url);
      if (prev.some((x) => x.id === app.id || normaliseUrlForDedupe(x.url) === appKey)) return prev;
      return [...prev, app];
    });
  };

  const handlePresetAppAdd = (app: AppShortcut) => {
    addAppShortcut(app);
    setShowAppPicker(false);
    setCustomAppName("");
    setCustomAppUrl("");
    setCustomAppIconUrl("");
    setAppPickerError(null);
  };

  const handleCustomAppAdd = async () => {
    if (addingCustomApp) return;
    const normalizedUrl = ensureUrlProtocol(customAppUrl);
    if (!normalizedUrl) {
      setAppPickerError("Please enter a URL.");
      return;
    }

    let url = "";
    try {
      url = new URL(normalizedUrl).toString();
    } catch {
      setAppPickerError("Please enter a valid URL.");
      return;
    }

    setAddingCustomApp(true);
    setAppPickerError(null);
    try {
      const meta = await fetchMeta(url);
      const domain = domainFromUrl(url);
      const defaultName = domain || "Custom app";
      const trimmedIconUrl = customAppIconUrl.trim();
      const app: AppShortcut = {
        id: `custom:${domain || Date.now().toString(36)}:${Date.now().toString(36)}`,
        name: customAppName.trim() || meta.title?.trim() || defaultName,
        url,
        iconUrl: trimmedIconUrl || undefined,
        icon: meta.favicon || faviconFromUrl(url),
        group: "Custom",
        custom: true,
      };
      addAppShortcut(app);
      setShowAppPicker(false);
      setCustomAppName("");
      setCustomAppUrl("");
      setCustomAppIconUrl("");
    } catch {
      setAppPickerError("Could not fetch this URL. Please try another one.");
    } finally {
      setAddingCustomApp(false);
    }
  };

  const handleOpenAppShortcut = (app: AppShortcut) => {
    window.open(app.url, "_blank", "noopener,noreferrer");
  };

  const handleAddBookmarkToApps = (bookmarkId: string) => {
    const source = bookmarks.find((b) => b.id === bookmarkId);
    if (!source) return;
    const sourceUrlKey = normaliseUrlForDedupe(source.url);
    const exists = appShortcuts.some(
      (x) => x.id === `bookmark:${source.id}` || normaliseUrlForDedupe(x.url) === sourceUrlKey
    );
    if (exists) {
      setDropResult("App already exists in Apps.");
      setTimeout(() => setDropResult(null), 1800);
      return;
    }
    const app: AppShortcut = {
      id: `bookmark:${source.id}`,
      name: source.title?.trim() || domainFromUrl(source.url) || "Bookmark",
      url: source.url,
      icon: source.favicon || faviconFromUrl(source.url),
      group: "Custom",
      custom: true,
    };
    addAppShortcut(app);
    setDropResult("Added bookmark to Apps.");
    setTimeout(() => setDropResult(null), 1800);
  };

  const handleRemoveAppShortcut = (app: AppShortcut) => {
    const ok = window.confirm(`Remove ${app.name} from Apps?`);
    if (!ok) return;
    setAppShortcuts((prev) => prev.filter((x) => x.id !== app.id));
  };

  const openEditAppDialog = (app: AppShortcut) => {
    setAppEditor({ mode: "edit", appId: app.id });
    setAppEditorName(app.name);
    setAppEditorUrl(app.url);
    setAppEditorIconUrl("");
    setAppEditorError(null);
  };

  const openChangeIconDialog = (app: AppShortcut) => {
    setAppEditor({ mode: "icon", appId: app.id });
    setAppEditorName("");
    setAppEditorUrl("");
    setAppEditorIconUrl(app.iconUrl ?? app.icon ?? "");
    setAppEditorError(null);
  };

  const closeAppEditorDialog = () => {
    setAppEditor(null);
    setAppEditorError(null);
  };

  const saveAppEditorDialog = () => {
    if (!appEditor) return;
    const app = appShortcuts.find((x) => x.id === appEditor.appId);
    if (!app) {
      closeAppEditorDialog();
      return;
    }

    if (appEditor.mode === "edit") {
      const nextName = appEditorName.trim();
      if (!nextName) {
        setAppEditorError("Name is required.");
        return;
      }

      const normalized = ensureUrlProtocol(appEditorUrl.trim());
      if (!normalized) {
        setAppEditorError("URL is required.");
        return;
      }

      let nextUrl = "";
      try {
        nextUrl = new URL(normalized).toString();
      } catch {
        setAppEditorError("Please enter a valid URL.");
        return;
      }

      const duplicate = appShortcuts.find(
        (x) => x.id !== app.id && normaliseUrlForDedupe(x.url) === normaliseUrlForDedupe(nextUrl)
      );
      if (duplicate) {
        setAppEditorError(`Another app already uses this URL: ${duplicate.name}`);
        return;
      }

      setAppShortcuts((prev) =>
        prev.map((x) => {
          if (x.id !== app.id) return x;
          const keepCurrentIcon = !!x.iconUrl;
          return {
            ...x,
            name: nextName,
            url: nextUrl,
            icon: keepCurrentIcon ? x.icon : faviconFromUrl(nextUrl),
          };
        })
      );
      closeAppEditorDialog();
      return;
    }

    const nextIcon = sanitizeLegacyIconUrl(appEditorIconUrl.trim());
    if (!nextIcon) {
      setAppEditorError("Icon URL is required.");
      return;
    }

    setAppShortcuts((prev) =>
      prev.map((x) => {
        if (x.id !== app.id) return x;
        return { ...x, iconUrl: nextIcon, icon: nextIcon };
      })
    );
    closeAppEditorDialog();
  };

  const getDraggedAppId = (e: React.DragEvent): string => {
    const directId = e.dataTransfer.getData(APP_SHORTCUT_DRAG_MIME);
    const plain = e.dataTransfer.getData("text/plain");
    const fallbackId = plain.startsWith(APP_SHORTCUT_DRAG_FALLBACK_PREFIX)
      ? plain.slice(APP_SHORTCUT_DRAG_FALLBACK_PREFIX.length)
      : "";
    return directId || fallbackId;
  };

  const handleAppShortcutDragStart = (appId: string, e: React.DragEvent) => {
    if (appDragHoverTimerRef.current) {
      clearTimeout(appDragHoverTimerRef.current);
      appDragHoverTimerRef.current = null;
    }
    setAppDragReadyId(null);
    setAppDraggingId(appId);
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData(APP_SHORTCUT_DRAG_MIME, appId);
    e.dataTransfer.setData("text/plain", `${APP_SHORTCUT_DRAG_FALLBACK_PREFIX}${appId}`);
  };

  const handleReorderAppShortcut = (targetId: string, e: React.DragEvent) => {
    e.preventDefault();
    const draggedId = getDraggedAppId(e);
    setAppDraggingId(null);
    if (!draggedId || draggedId === targetId) return;

    setAppShortcuts((prev) => {
      const from = prev.findIndex((x) => x.id === draggedId);
      const to = prev.findIndex((x) => x.id === targetId);
      if (from < 0 || to < 0 || from === to) return prev;
      const next = [...prev];
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved);
      return next;
    });
  };

  const handleAppShortcutMouseEnter = (appId: string) => {
    if (appDragHoverTimerRef.current) {
      clearTimeout(appDragHoverTimerRef.current);
    }
    setAppDragReadyId(null);
    appDragHoverTimerRef.current = setTimeout(() => {
      setAppDragReadyId(appId);
      appDragHoverTimerRef.current = null;
    }, 2000);
  };

  const handleAppShortcutMouseLeave = (appId: string) => {
    if (appDragHoverTimerRef.current) {
      clearTimeout(appDragHoverTimerRef.current);
      appDragHoverTimerRef.current = null;
    }
    setAppDragReadyId((prev) => (prev === appId ? null : prev));
  };

  const handleBackup = () => {
    const exportableBookmarks = stripSystemTagsFromBookmarks(bookmarks);
    const payload: BackupPayloadV2 = {
      version: 2,
      bookmarks: exportableBookmarks,
      customTags,
      preferences: {
        theme,
        displayMode,
        groupByDate,
        sortBy,
        rankOrder,
        zoom,
        tagOrder,
        sidebarOpen,
        appShortcuts,
        appCatalog,
        cleanupBypassTags,
      },
    };
    const data = JSON.stringify(payload, null, 2);
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([data], { type: "application/json" }));
    a.download = `bookmarks-backup-${localDateKey()}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const handleRestoreFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const parsed = JSON.parse(ev.target?.result as string);

        // Backward-compatible: legacy backups were bookmark arrays only.
        if (Array.isArray(parsed)) {
          if (!window.confirm(`Restore ${parsed.length} bookmarks? This will replace your current library.`)) return;
          replaceBookmarks(stripSystemTagsFromBookmarks(parsed));
          return;
        }

        if (!parsed || typeof parsed !== "object" || !Array.isArray(parsed.bookmarks)) {
          throw new Error("Invalid backup format");
        }

        const payload = parsed as Partial<BackupPayloadV2>;
        const count = payload.bookmarks?.length ?? 0;
        if (!window.confirm(`Restore ${count} bookmarks and settings? This will replace your current library and preferences.`)) return;

        replaceBookmarks(stripSystemTagsFromBookmarks(payload.bookmarks ?? []));

        if (Array.isArray(payload.customTags)) {
          replaceCustomTags(payload.customTags);
        }

        const prefs = sanitizeBackupPreferences(payload.preferences, THEME_CYCLE);
        if (prefs.theme && THEME_CYCLE.includes(prefs.theme as ThemeId)) setTheme(prefs.theme as ThemeId);
        if (prefs.displayMode) setDisplayMode(prefs.displayMode);
        if (typeof prefs.groupByDate === "boolean") setGroupByDate(prefs.groupByDate);
        if (prefs.sortBy) setSortBy(prefs.sortBy);
        if (Array.isArray(prefs.rankOrder)) {
          setRankOrder(prefs.rankOrder);
        } else {
            // Fallback for older backups: derive ranking order from bookmark.ranking.
            const fallbackRankOrder = (payload.bookmarks ?? [])
              .filter((b) => typeof b.ranking === "number")
              .sort((a, b) => (b.ranking ?? 0) - (a.ranking ?? 0))
              .map((b) => b.id)
              .filter((id): id is string => typeof id === "string");
            if (fallbackRankOrder.length > 0) {
              setRankOrder(fallbackRankOrder);
            }
        }
        if (typeof prefs.zoom === "number") setZoom(prefs.zoom);
        if (Array.isArray(prefs.tagOrder)) setTagOrder(prefs.tagOrder);
        if (Array.isArray(prefs.cleanupBypassTags)) setCleanupBypassTags(prefs.cleanupBypassTags);
        if (typeof prefs.sidebarOpen === "boolean") setSidebarOpen(prefs.sidebarOpen);
        if (Array.isArray(prefs.appShortcuts)) {
            const restoredApps = prefs.appShortcuts
              .filter((item) => !!item && typeof item === "object")
              .map((item) => normaliseAppShortcut(item as Record<string, unknown>, "Custom"))
              .filter((item): item is AppShortcut => item !== null);
            setAppShortcuts(restoredApps);
        }
        if (Array.isArray(prefs.appCatalog)) {
            const restoredCatalog = prefs.appCatalog
              .filter((g) => !!g && typeof g === "object")
              .map((g) => {
                const obj = g as Record<string, unknown>;
                const groupName = String(obj.group ?? "Custom").trim() || "Custom";
                const rawApps = Array.isArray(obj.apps) ? obj.apps : [];
                const apps = rawApps
                  .filter((a) => !!a && typeof a === "object")
                  .map((a) => normaliseAppShortcut(a as Record<string, unknown>, groupName))
                  .filter((a): a is AppShortcut => a !== null);
                if (apps.length === 0) return null;
                return { group: groupName, apps } satisfies AppGroup;
              })
              .filter((g): g is AppGroup => g !== null);
            setAppCatalog(restoredCatalog);
        }
      } catch {
        alert("Could not read backup file — make sure it's a valid bookmarks backup JSON.");
      }
    };
    reader.readAsText(file);
  };

  const handleCleanup = async () => {
    if (cleanupState.running) return;
    const bypassTagSet = new Set(cleanupBypassTags);
    const isBypassedBookmark = (bookmark: Bookmark) =>
      bookmark.tags.some((tag) => bypassTagSet.has(tag));
    const scanCandidates = bookmarks.filter((b) => !isBypassedBookmark(b));

    // Step 1: deduplicate by canonical URL (ignores protocol + www), merging tags/details.
    const dedupeIndex = new Map<string, number>();
    const deduped: Bookmark[] = [];
    for (const b of scanCandidates) {
      const key = normaliseUrlForDedupe(b.url);
      const existingIdx = dedupeIndex.get(key);
      if (existingIdx === undefined) {
        dedupeIndex.set(key, deduped.length);
        deduped.push({
          ...b,
          title: normaliseBookmarkTitle(b.title, b.url),
          tags: Array.from(new Set(b.tags)),
        });
        continue;
      }
      const existing = deduped[existingIdx];
      deduped[existingIdx] = {
        ...existing,
        title: normaliseBookmarkTitle(existing.title || b.title, preferCanonicalUrl(existing.url, b.url)),
        url: preferCanonicalUrl(existing.url, b.url),
        description: existing.description?.trim() ? existing.description : b.description,
        favicon: existing.favicon || b.favicon,
        tags: Array.from(new Set([...existing.tags, ...b.tags])),
      };
    }
    const removedCount = scanCandidates.length - deduped.length;
    const dedupedById = new Map(deduped.map((b) => [b.id, b] as const));
    const afterDedupe = bookmarks
      .map((b) => (isBypassedBookmark(b) ? b : dedupedById.get(b.id)))
      .filter((b): b is Bookmark => !!b);
    replaceBookmarks(afterDedupe);

    // Step 2: enrich missing descriptions and recalculate reachability.
    const needsMeta = deduped.filter((b) => !b.description?.trim() || isHostnameLikeTitle(b.title, b.url));
    setCleanupState({ running: true, progress: 0, total: needsMeta.length + deduped.length });

    let enrichedCount = 0;
    let nextBookmarks = [...deduped];
    for (let i = 0; i < needsMeta.length; i++) {
      const bookmark = needsMeta[i];
      const meta = await fetchMeta(bookmark.url);
      const newDesc = meta.description?.trim() || "";
      const newTitle = meta.title?.trim() || "";
      const newFavicon = meta.favicon || "";
      if (newTitle || newDesc || newFavicon) {
        nextBookmarks = nextBookmarks.map((b) => {
          if (b.id !== bookmark.id) return b;
          const hadDescription = !!b.description?.trim();
          const shouldReplaceTitle = isHostnameLikeTitle(b.title, b.url) && !!newTitle;
          const updated = {
            ...b,
            ...(shouldReplaceTitle ? { title: newTitle } : {}),
            ...(newDesc ? { description: newDesc } : {}),
            ...(newFavicon ? { favicon: newFavicon } : {}),
          };
          if (!hadDescription && !!updated.description?.trim()) enrichedCount++;
          return updated;
        });
      }
      setCleanupState((s) => ({ ...s, progress: i + 1 }));
    }

    for (let i = 0; i < nextBookmarks.length; i++) {
      const b = nextBookmarks[i];
      const reachability = await resolveReachability(b.url);
      const hasUnreachableTag = b.tags.includes(SYSTEM_TAG_NOT_REACHABLE);
      if (!reachability.reachable && !hasUnreachableTag) {
        nextBookmarks[i] = { ...b, tags: [...b.tags, SYSTEM_TAG_NOT_REACHABLE] };
      } else if (reachability.reachable) {
        const nextUrl = reachability.resolvedUrl ?? b.url;
        const nextTags = hasUnreachableTag
          ? b.tags.filter((t) => t !== SYSTEM_TAG_NOT_REACHABLE)
          : b.tags;

        if (nextUrl !== b.url) {
          const meta = await fetchMeta(nextUrl);
          const nextTitle = meta.title?.trim() || b.title;
          const nextDescription = meta.description?.trim();
          const nextFavicon = meta.favicon || b.favicon;
          nextBookmarks[i] = {
            ...b,
            url: nextUrl,
            title: nextTitle,
            description: nextDescription ?? b.description,
            favicon: nextFavicon,
            tags: nextTags,
          };
        } else if (hasUnreachableTag) {
          nextBookmarks[i] = {
            ...b,
            tags: nextTags,
          };
        }
      }
      setCleanupState((s) => ({ ...s, progress: needsMeta.length + i + 1 }));
    }
    // Step 3: detect potential duplicates by similar base URL and mark as Not Unique.
    const baseCounts = new Map<string, number>();
    for (const b of nextBookmarks) {
      const key = similarBaseUrlKey(b.url);
      baseCounts.set(key, (baseCounts.get(key) ?? 0) + 1);
    }

    nextBookmarks = nextBookmarks.map((b) => {
      const key = similarBaseUrlKey(b.url);
      const isNotUnique = (baseCounts.get(key) ?? 0) > 1;
      const hasNotUniqueTag = b.tags.includes(SYSTEM_TAG_NOT_UNIQUE);
      if (isNotUnique && !hasNotUniqueTag) {
        return { ...b, tags: [...b.tags, SYSTEM_TAG_NOT_UNIQUE] };
      }
      if (!isNotUnique && hasNotUniqueTag) {
        return { ...b, tags: b.tags.filter((t) => t !== SYSTEM_TAG_NOT_UNIQUE) };
      }
      return b;
    });

    const cleanedById = new Map(nextBookmarks.map((b) => [b.id, b] as const));
    const finalBookmarks = afterDedupe
      .map((b) => (isBypassedBookmark(b) ? b : cleanedById.get(b.id)))
      .filter((b): b is Bookmark => !!b);

    const notUniqueCount = finalBookmarks.filter((b) => b.tags.includes(SYSTEM_TAG_NOT_UNIQUE)).length;
    const notReachableCount = finalBookmarks.filter((b) => b.tags.includes(SYSTEM_TAG_NOT_REACHABLE)).length;
    replaceBookmarks(finalBookmarks);
    setCleanupState({ running: false, progress: 0, total: 0 });
    setCleanupResult({
      removed: removedCount,
      missingFound: needsMeta.length,
      missingFixed: enrichedCount,
      notUnique: notUniqueCount,
      notReachable: notReachableCount,
    });
  };

  return (
    <>
      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
        @keyframes pulseBlue {
          0% { opacity: 0.35; transform: scale(0.82); }
          60% { opacity: 1; transform: scale(1.06); }
          100% { opacity: 0.35; transform: scale(0.82); }
        }
        @keyframes shimmer {
          0% { background-position: 200% 0; }
          100% { background-position: -200% 0; }
        }
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body { overflow: hidden; }
        ::-webkit-scrollbar { width: 6px; }
        ::-webkit-scrollbar-track { background: transparent; }
        ::-webkit-scrollbar-thumb { background: var(--border-hover); border-radius: 3px; }
      `}</style>

      <div data-theme={theme} style={{
        display: "flex", height: "100vh",
        background: "var(--bg)",
        fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
        color: "var(--text)", overflow: "hidden",
      }}>
        {/* Sidebar */}
        <aside style={{
          width: sidebarOpen ? 196 : 0,
          flexShrink: 0, background: "var(--surface)",
          borderRight: sidebarOpen ? "1px solid var(--border)" : "none",
          display: "flex", flexDirection: "column",
          overflowY: sidebarOpen ? "auto" : "hidden",
          overflowX: "hidden",
          transition: "width 0.22s ease, border 0.22s ease",
        }}>
          <div style={{
            width: 196, display: "flex", flexDirection: "column",
            padding: "20px 0", minHeight: "100%",
          }}>
            <div style={{ padding: "0 8px 6px 16px", display: "flex", alignItems: "center" }}>
              <span style={{ fontSize: 11, fontWeight: 700, color: "var(--text-4)", letterSpacing: "0.07em", textTransform: "uppercase", flex: 1 }}>
                Apps
              </span>
              <button
                onClick={() => { setShowAppPicker(true); setAppPickerError(null); }}
                title="Add app shortcut"
                style={{
                  background: "none", border: "1px solid var(--border-hover)", borderRadius: 5,
                  color: "var(--text-3)", fontSize: 11, fontWeight: 600, cursor: "pointer",
                  padding: "2px 7px", lineHeight: 1.4,
                }}
              >
                + New
              </button>
            </div>
            <div
              style={{ display: "flex", flexWrap: "wrap", justifyContent: "flex-start", gap: 10, padding: "0 10px 12px 14px" }}
              onDragOver={(e) => {
                const hasAppData = e.dataTransfer.types.includes(APP_SHORTCUT_DRAG_MIME);
                const hasBookmarkData = e.dataTransfer.types.includes(BOOKMARK_DRAG_MIME);
                if (!hasAppData && !hasBookmarkData) return;
                e.preventDefault();
                e.dataTransfer.dropEffect = "move";
              }}
              onDrop={(e) => {
                const draggedBookmarkId = getDraggedBookmarkId(e);
                if (draggedBookmarkId) {
                  e.preventDefault();
                  handleAddBookmarkToApps(draggedBookmarkId);
                }
              }}
            >
              {appShortcuts.map((app) => {
                return (
                  <div
                    key={app.id}
                    style={{ position: "relative", width: 24, height: 24 }}
                    onDragOver={(e) => {
                      const hasAppData = e.dataTransfer.types.includes(APP_SHORTCUT_DRAG_MIME);
                      const hasBookmarkData = e.dataTransfer.types.includes(BOOKMARK_DRAG_MIME);
                      if (!hasAppData && !hasBookmarkData) return;
                      e.preventDefault();
                      e.dataTransfer.dropEffect = "move";
                    }}
                    onDrop={(e) => {
                      const draggedBookmarkId = getDraggedBookmarkId(e);
                      if (draggedBookmarkId) {
                        e.preventDefault();
                        e.stopPropagation();
                        handleAddBookmarkToApps(draggedBookmarkId);
                        return;
                      }
                      handleReorderAppShortcut(app.id, e);
                    }}
                  >
                    <button
                      draggable
                      onDragStart={(e) => handleAppShortcutDragStart(app.id, e)}
                      onDragEnd={() => {
                        setAppDraggingId(null);
                        setAppDragReadyId(null);
                      }}
                      onMouseEnter={() => handleAppShortcutMouseEnter(app.id)}
                      onMouseLeave={() => handleAppShortcutMouseLeave(app.id)}
                      title={`${app.name} — ${app.url}`}
                      onClick={() => { handleOpenAppShortcut(app); }}
                      onContextMenu={(e) => {
                        e.preventDefault();
                        setAppContextMenu({ x: e.clientX, y: e.clientY, appId: app.id });
                      }}
                      style={{
                        width: 24,
                        height: 24,
                        borderRadius: 6,
                        border: "1px solid var(--border)",
                        background: "var(--card)",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        cursor: appDragReadyId === app.id ? "grab" : "default",
                        padding: 0,
                        opacity: appDraggingId === app.id ? 0.6 : 1,
                      }}
                    >
                      <AppIcon app={app} width={24} height={24} radius={4} />
                    </button>
                  </div>
                );
              })}
            </div>
            {appContextMenu && (() => {
              const app = appShortcuts.find((a) => a.id === appContextMenu.appId);
              if (!app) return null;
              return (
                <div
                  ref={appContextMenuRef}
                  onClick={(e) => e.stopPropagation()}
                  style={{
                    position: "fixed",
                    left: appContextMenu.x,
                    top: appContextMenu.y,
                    minWidth: 154,
                    background: "var(--card)",
                    border: "1px solid var(--border-hover)",
                    borderRadius: 8,
                    boxShadow: "0 10px 26px rgba(0,0,0,0.45)",
                    padding: 4,
                    zIndex: 3000,
                  }}
                >
                  <button
                    onClick={() => {
                      openEditAppDialog(app);
                      setAppContextMenu(null);
                    }}
                    style={appContextMenuBtn}
                  >
                    Edit App
                  </button>
                  <button
                    onClick={() => {
                      openChangeIconDialog(app);
                      setAppContextMenu(null);
                    }}
                    style={appContextMenuBtn}
                  >
                    Change App Icon
                  </button>
                  <div style={{ height: 1, background: "var(--border)", margin: "4px 0" }} />
                  <button
                    onClick={() => {
                      handleRemoveAppShortcut(app);
                      setAppContextMenu(null);
                    }}
                    style={appContextMenuBtn}
                  >
                    Delete App
                  </button>
                </div>
              );
            })()}

            <div
              style={{
                height: 1,
                margin: "2px 12px 12px",
                background: "var(--border)",
              }}
            />

            <div style={{ padding: "0 8px 14px 16px", display: "flex", alignItems: "center" }}>
                <span style={{ fontSize: 11, fontWeight: 700, color: "var(--text-4)", letterSpacing: "0.07em", textTransform: "uppercase", flex: 1 }}>
                {t("tags")}
              </span>
              <button
                onClick={() => { setNewTagInput(""); setTimeout(() => newTagRef.current?.focus(), 50); }}
                title={t("createNewTag")}
                style={{
                  background: "none", border: "1px solid var(--border-hover)", borderRadius: 5,
                  color: "var(--text-3)", fontSize: 11, fontWeight: 600, cursor: "pointer",
                  padding: "2px 7px", lineHeight: 1.4,
                }}
              >
                {t("newShort")}
              </button>
            </div>
            {newTagInput !== null && (
              <div style={{ margin: "0 8px 8px", display: "flex", alignItems: "center", gap: 4 }}>
                <input
                  ref={newTagRef}
                  type="text"
                  value={newTagInput}
                  placeholder={t("tagNamePlaceholder")}
                  onChange={(e) => setNewTagInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      addTag(newTagInput);
                      setNewTagInput(null);
                    }
                    if (e.key === "Escape") setNewTagInput(null);
                  }}
                  onBlur={() => setNewTagInput(null)}
                  style={{
                    flex: 1, background: "var(--bg)", border: "1px solid #3b82f6",
                    borderRadius: 6, padding: "4px 8px", color: "var(--text)", fontSize: 13, outline: "none",
                  }}
                />
              </div>
            )}
            <TagChip label={t("all")} count={bookmarks.length} active={selectedTag === null} onClick={() => setSelectedTag(null)} vertical />
            <TagChip
              label={t("notTagged")}
              count={bookmarks.filter((b) => visibleTags(b.tags).length === 0).length}
              active={selectedTag === NOT_TAGGED_FILTER}
              onClick={() => setSelectedTag(selectedTag === NOT_TAGGED_FILTER ? null : NOT_TAGGED_FILTER)}
              onClear={handleClearNotTagged}
              vertical
            />
            <TagChip
              label={t("notUnique")}
              count={bookmarks.filter((b) => b.tags.includes(SYSTEM_TAG_NOT_UNIQUE)).length}
              active={selectedTag === NOT_UNIQUE_FILTER}
              onClick={() => setSelectedTag(selectedTag === NOT_UNIQUE_FILTER ? null : NOT_UNIQUE_FILTER)}
              onClear={handleClearNotUnique}
              vertical
            />
            <TagChip
              label={t("notReachable")}
              count={bookmarks.filter((b) => b.tags.includes(SYSTEM_TAG_NOT_REACHABLE)).length}
              active={selectedTag === NOT_REACHABLE_FILTER}
              onClick={() => setSelectedTag(selectedTag === NOT_REACHABLE_FILTER ? null : NOT_REACHABLE_FILTER)}
              onClear={handleClearNotReachable}
              vertical
            />
            <div style={{ height: 6 }} />
            {orderedSidebarTags.map((tag) => {
              const count = bookmarks.filter((b) => b.tags.includes(tag)).length;
              return (
                <SidebarTagRow
                  key={tag}
                  tag={tag}
                  count={count}
                  active={selectedTag === tag}
                  onSelect={() => setSelectedTag(selectedTag === tag ? null : tag)}
                  onRename={(newName) => handleRenameSidebarTag(tag, newName)}
                  onDelete={() => setPendingTagDelete(tag)}
                  onClear={() => clearTag(tag)}
                  cleanupBypassed={cleanupBypassTags.includes(tag)}
                  onToggleCleanupBypass={() => {
                    setCleanupBypassTags((prev) =>
                      prev.includes(tag)
                        ? prev.filter((t) => t !== tag)
                        : [...prev, tag]
                    );
                  }}
                  onChangeColor={() => {
                    cycleTagColor(tag);
                    setTagColorVersion((v) => v + 1);
                  }}
                  onBookmarkDrop={(bookmarkId) => handleBookmarkDropOnTag(bookmarkId, tag)}
                  onTagReorder={handleReorderSidebarTag}
                />
              );
            })}
          </div>
        </aside>

        {/* Main */}
        <div
          style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden", position: "relative" }}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
        >
          {/* Toolbar */}
          <header style={{
            display: "flex", alignItems: "center", gap: 8,
            padding: "9px 16px", borderBottom: "1px solid var(--border)",
            background: "var(--surface)", flexShrink: 0,
          }}>
            <button
              onClick={() => setSidebarOpen(v => !v)}
              title={sidebarOpen ? "Collapse sidebar" : "Expand sidebar"}
              style={{
                display: "flex", alignItems: "center", justifyContent: "center",
                width: 28, height: 28, borderRadius: 7, border: "none",
                background: "var(--card)", color: "var(--text-2)",
                cursor: "pointer", flexShrink: 0,
              }}
            >
              <IconSidebar flipped={!sidebarOpen} />
            </button>
            <button
              onClick={() => setTheme((t) => nextTheme(t))}
              title={t("themeSwitchTooltip", { theme })}
              style={{
                display: "flex", alignItems: "center", justifyContent: "center",
                width: 28, height: 28, borderRadius: 7, border: "none",
                background: "var(--card)", color: "var(--theme-icon-color, var(--text-2))",
                cursor: "pointer", flexShrink: 0,
              }}
            >
              {DARK_THEME_IDS.has(theme) ? <IconMoon /> : <IconSun />}
            </button>
            <button
              onClick={handleCollapseTabs}
              title={t("collapseTabsTooltip")}
              disabled={collapseTabsLoading}
              style={{
                display: "flex", alignItems: "center", justifyContent: "center",
                width: 28, height: 28, borderRadius: 7, border: "none",
                background: "var(--card)", color: "var(--text-2)",
                cursor: collapseTabsLoading ? "not-allowed" : "pointer", flexShrink: 0,
                opacity: collapseTabsLoading ? 0.5 : 1,
              }}
            >
              <IconCollapseTabs />
            </button>
            <button
              onClick={handleExpandTabs}
              title={t("expandSelectedTooltip")}
              disabled={expandTabsLoading || !selectedTag}
              style={{
                display: "flex", alignItems: "center", justifyContent: "center",
                width: 28, height: 28, borderRadius: 7, border: "none",
                background: "var(--card)", color: "var(--text-2)",
                cursor: expandTabsLoading || !selectedTag ? "not-allowed" : "pointer", flexShrink: 0,
                opacity: expandTabsLoading || !selectedTag ? 0.5 : 1,
              }}
            >
              <IconExpandTabs />
            </button>
            <a href="https://www.bookmarkmaster.com" target="_blank" rel="noreferrer"
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                fontSize: 15,
                fontWeight: 700,
                marginRight: 4,
                color: "var(--text)",
                textDecoration: "none",
              }}
              onMouseEnter={(e) => (e.currentTarget.style.textDecoration = "underline")}
              onMouseLeave={(e) => (e.currentTarget.style.textDecoration = "none")}
            >
              <img
                src="/favicon.png"
                alt="BookMarkMaster icon"
                width={16}
                height={16}
                style={{ borderRadius: 4, flexShrink: 0 }}
              />
              <span>BookmarkMaster.com</span>
            </a>
            <span
              style={{
                marginLeft: 2,
                alignSelf: "flex-end",
                marginBottom: 1,
                color: "var(--text-4)",
                fontSize: 11,
                fontWeight: 700,
                letterSpacing: "0.02em",
              }}
            >
              v1.0.2
            </span>

            <div style={{ flex: 1 }} />

            <input type="text" placeholder={t("searchPlaceholder")} value={search}
              onChange={(e) => setSearch(e.target.value)}
              style={{ background: "var(--card)", border: "1px solid var(--border-hover)", borderRadius: 7, padding: "6px 12px", color: "var(--text)", fontSize: 13, outline: "none", width: 220 }}
            />

            <span style={{ fontSize: 12, color: "var(--text-4)", minWidth: 62, fontVariantNumeric: "tabular-nums", textAlign: "right" }}>
              {sorted.length.toLocaleString()}
            </span>

            <Divider />

            {/* View mode */}
            <ToggleGroup>
              <ToggleBtn active={displayMode === "grid"} onClick={() => setDisplayMode("grid")} title={t("tileView")} icon={<IconTile />} />
              <ToggleBtn active={displayMode === "list"} onClick={() => setDisplayMode("list")} title={t("tableView")} icon={<IconTable />} />
              <ToggleBtn active={displayMode === "preview"} onClick={() => setDisplayMode("preview")} title={t("previewView")} icon={<IconPreview />} />
            </ToggleGroup>

            {/* Layer toggles */}
            <ToggleGroup>
              <ToggleBtn active={groupByDate} onClick={() => { setSortBy("date"); setGroupByDate(v => !v); }} title={t("groupByDate")} icon={<IconCalendar />} />
            </ToggleGroup>

            <select
              value={sortBy}
              onChange={(e) => { const next = e.target.value as typeof sortBy; setSortBy(next); if (next !== "date") setGroupByDate(false); }}
              title={t("sortOrder")}
              style={{
                background: "var(--card)", border: "1px solid var(--border-hover)",
                borderRadius: 7, padding: "0 8px", color: "var(--text-2)",
                fontSize: 13, cursor: "pointer", outline: "none",
                height: 30, boxSizing: "border-box",
              }}
            >
              <option value="date">{t("dateAdded")}</option>
              <option value="name">{t("nameAZ")}</option>
              <option value="ranking">{t("ranking")}</option>
            </select>

            <div ref={dataMenuRef} style={{ position: "relative" }}>
              {cleanupState.running && (
                <span
                  style={{
                    position: "absolute",
                    left: 8,
                    top: 0,
                    bottom: 0,
                    display: "flex",
                    alignItems: "center",
                    zIndex: 1,
                    pointerEvents: "none",
                  }}
                >
                  <CleanupProgressRing percent={cleanupPercent} />
                </span>
              )}
              <select
                value="my-data"
                onChange={() => {}}
                onMouseDown={(e) => {
                  e.preventDefault();
                  setShowDataMenu((v) => !v);
                }}
                onClick={(e) => e.preventDefault()}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " " || e.key === "ArrowDown") {
                    e.preventDefault();
                    setShowDataMenu(true);
                  }
                  if (e.key === "Escape") {
                    setShowDataMenu(false);
                  }
                }}
                aria-label={t("myData")}
                style={{
                  background: "var(--card)", border: "1px solid var(--border-hover)",
                  borderRadius: 7,
                  padding: cleanupState.running ? "0 24px 0 22px" : "0 24px 0 10px",
                  color: "var(--text-2)",
                  fontSize: 13, cursor: "pointer", outline: "none",
                  height: 30, boxSizing: "border-box",
                  width: cleanupState.running ? 102 : 96,
                }}
              >
                <option value="my-data">{t("myData")}</option>
              </select>

              {showDataMenu && (
                <div style={{
                  position: "absolute", top: "calc(100% + 6px)", left: 0,
                  background: "var(--card)", border: "1px solid var(--border-hover)",
                  borderRadius: 10, padding: "4px 0", zIndex: 200,
                  minWidth: 160, boxShadow: "0 8px 32px rgba(0,0,0,0.4)",
                }}>
                  <DataMenuItem
                    icon={<img src="/broom.png" alt="" style={{ width: 17, height: 17, opacity: 0.65, filter: "var(--icon-filter)" }} />}
                    label={t("cleanUp")}
                    disabled={cleanupState.running}
                    onClick={() => { setShowDataMenu(false); handleCleanup(); }}
                  />
                  <div style={{ height: 1, background: "var(--border)", margin: "4px 0" }} />
                  <DataMenuItem icon={<img src="/file-import.png" alt="" style={{ width: 17, height: 17, opacity: 0.65, filter: "var(--icon-filter)" }} />} label={t("import")} onClick={() => { setShowDataMenu(false); setShowImport(true); }} />
                  <DataMenuItem icon={<img src="/import-export.png" alt="" style={{ width: 17, height: 17, opacity: 0.65, filter: "var(--icon-filter)" }} />} label={t("export")} onClick={() => { setShowDataMenu(false); setShowExport(true); }} />
                  <div style={{ height: 1, background: "var(--border)", margin: "4px 0" }} />
                  <DataMenuItem icon="💾" label={t("backup")} onClick={() => { setShowDataMenu(false); handleBackup(); }} />
                  <DataMenuItem icon="📂" label={t("restore")} onClick={() => { setShowDataMenu(false); restoreFileRef.current?.click(); }} />
                  <div style={{ height: 1, background: "var(--border)", margin: "4px 0" }} />
                  <DataMenuItem icon="🏷️" label={t("clearAllTags")} danger onClick={() => { setShowDataMenu(false); setShowClearAllTags(true); }} />
                  <DataMenuItem icon="🗑️" label={t("deleteAll")} danger onClick={() => { setShowDataMenu(false); setShowDeleteAll(true); }} />
                </div>
              )}
            </div>

            <input ref={restoreFileRef} type="file" accept=".json" style={{ display: "none" }} onChange={handleRestoreFile} />

            <Divider />

            <button onClick={() => setModal({ mode: "add" })} style={{
              display: "flex", alignItems: "center", gap: 5,
              padding: "6px 12px", background: "#3b82f6", border: "none",
              borderRadius: 7, color: "#fff", fontSize: 13, fontWeight: 600, cursor: "pointer",
            }}>
              <span style={{ fontSize: 15, lineHeight: 1 }}>+</span> {t("add")}
            </button>
          </header>


          {/* Content */}
          <main style={{ flex: 1, overflowY: "auto", padding: 16 }}>
            {sorted.length === 0 ? (
              <Empty onAdd={() => setModal({ mode: "add" })} />
            ) : displayMode === "list" ? (
              <ListView
                bookmarks={sorted}
                zoom={zoom}
                onTagClick={setSelectedTag}
                onEdit={(b) => setModal({ mode: "edit", bookmark: b })}
                onDelete={handleDelete}
                onDragStartBookmark={handleBookmarkDragStart}
                onDropBookmarkOnBookmark={handleReorderBookmark}
                showPreview={false}
                groupByDate={effectiveGroupByDate}
                deleteConfirmId={deleteConfirm}
              />
            ) : (
              // Grid mode: plain grid or grouped
              effectiveGroupByDate ? (
                <TimelineView
                  bookmarks={sorted}
                  zoom={zoom}
                  onTagClick={setSelectedTag}
                  onEdit={(b) => setModal({ mode: "edit", bookmark: b })}
                  onDelete={handleDelete}
                  onDragStartBookmark={handleBookmarkDragStart}
                  onDropBookmarkOnBookmark={handleReorderBookmark}
                  showPreview={displayMode === "preview"}
                  groupByDate={effectiveGroupByDate}
                  deleteConfirmId={deleteConfirm}
                />
              ) : (
                <div style={{ display: "grid", gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`, gap: 10 }}>
                  {sorted
                    .map((b) => (
                      <BookmarkCard
                        key={b.id}
                        bookmark={b}
                        zoom={zoom}
                        onTagClick={setSelectedTag}
                        onEdit={() => setModal({ mode: "edit", bookmark: b })}
                        onDelete={() => handleDelete(b.id)}
                        onDragStartBookmark={handleBookmarkDragStart}
                        onDropBookmarkOnBookmark={handleReorderBookmark}
                        showPreview={displayMode === "preview"}
                        deleteConfirming={deleteConfirm === b.id}
                      />
                    ))}
                </div>
              )
            )}
          </main>

          {/* Drag-over overlay */}
          {(dragging || dropLoading) && (
            <div style={{
              position: "absolute", inset: 0, zIndex: 50,
              background: "rgba(17,17,19,0.88)",
              backdropFilter: "blur(4px)",
              display: "flex", flexDirection: "column",
              alignItems: "center", justifyContent: "center", gap: 16,
              border: "2px dashed #3b82f6",
              borderRadius: 2, pointerEvents: "none",
            }}>
              {dropLoading ? (
                <>
                  <div style={{ width: 32, height: 32, border: "3px solid #3b82f633", borderTop: "3px solid #3b82f6", borderRadius: "50%", animation: "spin 0.7s linear infinite" }} />
                  <span style={{ fontSize: 14, color: "var(--text-2)" }}>Fetching page info…</span>
                </>
              ) : (
                <>
                  <svg width="40" height="40" viewBox="0 0 40 40" fill="none" stroke="#3b82f6" strokeWidth="2">
                    <rect x="4" y="4" width="32" height="32" rx="6" />
                    <path d="M20 14v12M14 20l6-6 6 6" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                  <span style={{ fontSize: 15, fontWeight: 600, color: "var(--text)" }}>Drop to import bookmark{effectiveSelectedTag ? "s" : ""}</span>
                  {effectiveSelectedTag ? (
                    <span style={{ fontSize: 12, color: "#3b82f6" }}>Will be tagged "{effectiveSelectedTag}"</span>
                  ) : (
                    <span style={{ fontSize: 12, color: "var(--text-3)" }}>Drag from the address bar or any link</span>
                  )}
                </>
              )}
            </div>
          )}

          {/* Drop success toast */}
          {dropResult && (
            <div style={{
              position: "absolute", bottom: 60, left: "50%", transform: "translateX(-50%)",
              zIndex: 60, background: "#16a34a", color: "#fff",
              padding: "8px 18px", borderRadius: 20, fontSize: 13, fontWeight: 600,
              boxShadow: "0 4px 20px rgba(0,0,0,0.4)", pointerEvents: "none",
              whiteSpace: "nowrap",
            }}>
              ✓ {dropResult}
            </div>
          )}

          {/* Footer — zoom slider for tile/preview grid modes */}
          {displayMode !== "list" && (
            <footer style={{
              display: "flex", alignItems: "center", justifyContent: "flex-end",
              padding: "7px 16px", borderTop: "1px solid var(--border)",
              background: "var(--surface)", gap: 6, flexShrink: 0,
            }}>
              <SmallGridIcon size={11} />
              <input type="range" min={1} max={5} step={0.25} value={zoom}
                onChange={(e) => setZoom(Number(e.target.value))}
                style={{ width: 100, accentColor: "#3b82f6", cursor: "pointer" }}
              />
              <SmallGridIcon size={17} />
            </footer>
          )}
        </div>

        {modal.mode !== "closed" && (
          <BookmarkModal
            initial={modal.mode === "edit" ? modal.bookmark : null}
            prefill={modal.mode === "add" ? modal.prefill : undefined}
            existingTags={allTags}
            onSave={handleSave}
            onClose={() => setModal({ mode: "closed" })}
          />
        )}

        {showImport && (
          <ImportExportModal
            bookmarks={bookmarks}
            onImport={importBookmarks}
            onClose={() => setShowImport(false)}
            selectedTag={effectiveSelectedTag}
            allTags={allTags}
            section="import"
            backupPayload={{
              version: 2,
              customTags,
              preferences: {
                theme,
                displayMode,
                groupByDate,
                sortBy,
                rankOrder,
                zoom,
                tagOrder,
                sidebarOpen,
                appShortcuts,
                appCatalog,
                cleanupBypassTags,
              },
            }}
          />
        )}

        {showExport && (
          <ImportExportModal
            bookmarks={stripSystemTagsFromBookmarks(bookmarks)}
            onImport={importBookmarks}
            onClose={() => setShowExport(false)}
            selectedTag={effectiveSelectedTag}
            allTags={allTags}
            section="export"
            backupPayload={{
              version: 2,
              customTags,
              preferences: {
                theme,
                displayMode,
                groupByDate,
                sortBy,
                rankOrder,
                zoom,
                tagOrder,
                sidebarOpen,
                appShortcuts,
                appCatalog,
                cleanupBypassTags,
              },
            }}
          />
        )}

        {appEditor && (() => {
          const app = appShortcuts.find((x) => x.id === appEditor.appId);
          if (!app) return null;
          return (
            <div
              onClick={closeAppEditorDialog}
              style={{
                position: "fixed", inset: 0, background: "rgba(0,0,0,0.65)",
                backdropFilter: "blur(4px)", display: "flex",
                alignItems: "center", justifyContent: "center", zIndex: 1000,
              }}
            >
              <div
                onClick={(e) => e.stopPropagation()}
                style={{
                  background: "var(--card)", border: "1px solid var(--border-hover)",
                  borderRadius: 14, padding: 22, width: 520, maxWidth: "calc(100vw - 32px)",
                  display: "flex", flexDirection: "column", gap: 12,
                  boxShadow: "0 24px 60px rgba(0,0,0,0.6)",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                  <h2 style={{ fontSize: 16, fontWeight: 700, color: "var(--text)", margin: 0 }}>
                    {appEditor.mode === "edit" ? "Edit App" : "Change App Icon"}
                  </h2>
                  <button
                    onClick={closeAppEditorDialog}
                    style={{
                      width: 28, height: 28, borderRadius: 7, border: "1px solid var(--border-hover)",
                      background: "var(--card)", color: "var(--text-3)", cursor: "pointer",
                      fontSize: 15,
                    }}
                  >
                    ×
                  </button>
                </div>

                {appEditor.mode === "edit" ? (
                  <>
                    <input
                      type="text"
                      value={appEditorName}
                      onChange={(e) => {
                        setAppEditorName(e.target.value);
                        if (appEditorError) setAppEditorError(null);
                      }}
                      placeholder="App name"
                      style={{
                        background: "var(--bg)", border: "1px solid var(--border-hover)",
                        borderRadius: 7, padding: "8px 10px", color: "var(--text)", fontSize: 13, outline: "none",
                      }}
                    />
                    <input
                      type="text"
                      value={appEditorUrl}
                      onChange={(e) => {
                        setAppEditorUrl(e.target.value);
                        if (appEditorError) setAppEditorError(null);
                      }}
                      placeholder="https://example.com"
                      style={{
                        background: "var(--bg)", border: "1px solid var(--border-hover)",
                        borderRadius: 7, padding: "8px 10px", color: "var(--text)", fontSize: 13, outline: "none",
                      }}
                    />
                  </>
                ) : (
                  <input
                    type="text"
                    value={appEditorIconUrl}
                    onChange={(e) => {
                      setAppEditorIconUrl(e.target.value);
                      if (appEditorError) setAppEditorError(null);
                    }}
                    placeholder="https://example.com/icon.png"
                    style={{
                      background: "var(--bg)", border: "1px solid var(--border-hover)",
                      borderRadius: 7, padding: "8px 10px", color: "var(--text)", fontSize: 13, outline: "none",
                    }}
                  />
                )}

                {appEditorError && (
                  <span style={{ fontSize: 12, color: "#ef4444" }}>{appEditorError}</span>
                )}

                <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
                  <button
                    onClick={closeAppEditorDialog}
                    style={{
                      height: 34, padding: "0 14px", borderRadius: 8, border: "1px solid var(--border-hover)",
                      background: "var(--card)", color: "var(--text-2)", cursor: "pointer", fontSize: 13, fontWeight: 600,
                    }}
                  >
                    Cancel
                  </button>
                  <button
                    onClick={saveAppEditorDialog}
                    style={{
                      height: 34, padding: "0 14px", borderRadius: 8, border: "1px solid #3b82f6",
                      background: "#3b82f6", color: "#fff", cursor: "pointer", fontSize: 13, fontWeight: 700,
                    }}
                  >
                    Save
                  </button>
                </div>
              </div>
            </div>
          );
        })()}

                        {showAppPicker && (
          <div
            onClick={() => {
              setShowAppPicker(false);
              setAppPickerError(null);
            }}
            style={{
              position: "fixed", inset: 0, background: "rgba(0,0,0,0.65)",
              backdropFilter: "blur(4px)", display: "flex",
              alignItems: "center", justifyContent: "center", zIndex: 1000,
            }}
          >
            <div
              onClick={(e) => e.stopPropagation()}
              style={{
                background: "var(--card)", border: "1px solid var(--border-hover)",
                borderRadius: 14, padding: 22, width: 700, maxWidth: "calc(100vw - 32px)",
                maxHeight: "calc(100vh - 72px)", overflow: "auto",
                display: "flex", flexDirection: "column", gap: 14,
                boxShadow: "0 24px 60px rgba(0,0,0,0.6)",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <h2 style={{ fontSize: 16, fontWeight: 700, color: "var(--text)", margin: 0 }}>Add App Shortcut</h2>
                <button
                  onClick={() => setShowAppPicker(false)}
                  style={{
                    width: 28, height: 28, borderRadius: 7, border: "1px solid var(--border-hover)",
                    background: "var(--card)", color: "var(--text-3)", cursor: "pointer",
                    fontSize: 15,
                  }}
                >
                  ×
                </button>
              </div>

              <div style={{ border: "1px solid var(--border)", borderRadius: 10, padding: 12, display: "flex", flexDirection: "column", gap: 8 }}>
                <span style={{ fontSize: 12, color: "var(--text-3)", fontWeight: 700, letterSpacing: "0.05em", textTransform: "uppercase" }}>
                  Custom (Paste URL)
                </span>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  <input
                    type="text"
                    value={customAppName}
                    onChange={(e) => setCustomAppName(e.target.value)}
                    placeholder="Name (optional)"
                    style={{
                      flex: "1 1 180px", minWidth: 180, background: "var(--bg)", border: "1px solid var(--border-hover)",
                      borderRadius: 7, padding: "8px 10px", color: "var(--text)", fontSize: 13, outline: "none",
                    }}
                  />
                  <input
                    type="text"
                    value={customAppUrl}
                    onChange={(e) => setCustomAppUrl(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") void handleCustomAppAdd(); }}
                    placeholder="https://example.com"
                    style={{
                      flex: "2 1 260px", minWidth: 240, background: "var(--bg)", border: "1px solid var(--border-hover)",
                      borderRadius: 7, padding: "8px 10px", color: "var(--text)", fontSize: 13, outline: "none",
                    }}
                  />
                  <input
                    type="text"
                    value={customAppIconUrl}
                    onChange={(e) => setCustomAppIconUrl(e.target.value)}
                    placeholder="Icon URL or local icon name (optional)"
                    style={{
                      flex: "2 1 260px", minWidth: 240, background: "var(--bg)", border: "1px solid var(--border-hover)",
                      borderRadius: 7, padding: "8px 10px", color: "var(--text)", fontSize: 13, outline: "none",
                    }}
                  />
                  <button
                    onClick={() => { void handleCustomAppAdd(); }}
                    disabled={addingCustomApp}
                    style={{
                      background: "#3b82f6", border: "none", borderRadius: 7, color: "#fff",
                      fontSize: 13, fontWeight: 700, padding: "0 12px", height: 34,
                      cursor: addingCustomApp ? "not-allowed" : "pointer", opacity: addingCustomApp ? 0.6 : 1,
                    }}
                  >
                    {addingCustomApp ? "Adding…" : "Add Custom"}
                  </button>
                </div>
                {appPickerError && (
                  <span style={{ fontSize: 12, color: "#ef4444" }}>{appPickerError}</span>
                )}
              </div>

              {appCatalog.map((group) => (
                <div key={group.group} style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  <span style={{ fontSize: 12, color: "var(--text-3)", fontWeight: 700, letterSpacing: "0.05em", textTransform: "uppercase" }}>
                    {group.group}
                  </span>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))", gap: 8 }}>
                    {group.apps.map((app) => {
                      const alreadyAdded = appShortcuts.some((x) => x.id === app.id || normaliseUrlForDedupe(x.url) === normaliseUrlForDedupe(app.url));
                      return (
                        <button
                          key={app.id}
                          onClick={() => handlePresetAppAdd(app)}
                          disabled={alreadyAdded}
                          style={{
                            display: "flex", alignItems: "center", gap: 8, height: 34,
                            padding: "0 10px", borderRadius: 8,
                            border: `1px solid ${alreadyAdded ? "var(--border)" : "var(--border-hover)"}`,
                            background: alreadyAdded ? "var(--border)" : "var(--card)",
                            color: alreadyAdded ? "var(--text-4)" : "var(--text-2)",
                            cursor: alreadyAdded ? "not-allowed" : "pointer",
                            fontSize: 12, fontWeight: 600, textAlign: "left",
                          }}
                        >
                          <AppIcon app={app} width={16} height={15} radius={3} />
                          <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{app.name}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {showDeleteAll && (
          <div
            onClick={() => setShowDeleteAll(false)}
            style={{
              position: "fixed", inset: 0, background: "rgba(0,0,0,0.65)",
              backdropFilter: "blur(4px)", display: "flex",
              alignItems: "center", justifyContent: "center", zIndex: 1000,
            }}
          >
            <div
              onClick={(e) => e.stopPropagation()}
              style={{
                background: "var(--card)", border: "1px solid #ef444440",
                borderRadius: 14, padding: 28, width: 340,
                display: "flex", flexDirection: "column", gap: 18,
                boxShadow: "0 24px 60px rgba(0,0,0,0.6)",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                <span style={{ fontSize: 28 }}>🗑️</span>
                <h2 style={{ fontSize: 16, fontWeight: 700, color: "#ef4444", margin: 0 }}>Delete all bookmarks?</h2>
              </div>
              <p style={{ fontSize: 13, color: "var(--text-2)", lineHeight: 1.6, margin: 0 }}>
                This will permanently remove all <strong style={{ color: "var(--text)" }}>{bookmarks.length} bookmark{bookmarks.length !== 1 ? "s" : ""}</strong> from your library. Consider doing a <strong style={{ color: "var(--text)" }}>Backup</strong> first — this cannot be undone.
              </p>
              <div style={{ display: "flex", gap: 8 }}>
                <button
                  onClick={() => setShowDeleteAll(false)}
                  style={{
                    flex: 1, background: "var(--border)", border: "1px solid var(--border-hover)",
                    borderRadius: 8, padding: "9px 0", color: "var(--text-2)",
                    fontSize: 13, fontWeight: 600, cursor: "pointer",
                  }}
                >
                  Cancel
                </button>
                <button
                  onClick={() => { replaceBookmarks([]); setShowDeleteAll(false); }}
                  style={{
                    flex: 1, background: "#ef4444", border: "none",
                    borderRadius: 8, padding: "9px 0", color: "#fff",
                    fontSize: 13, fontWeight: 700, cursor: "pointer",
                  }}
                >
                  Delete all
                </button>
              </div>
            </div>
          </div>
        )}

        {showClearAllTags && (
          <div
            onClick={() => setShowClearAllTags(false)}
            style={{
              position: "fixed", inset: 0, zIndex: 1200,
              background: "rgba(0,0,0,0.55)",
              backdropFilter: "blur(4px)", display: "flex",
              alignItems: "center", justifyContent: "center",
            }}
          >
            <div
              onClick={(e) => e.stopPropagation()}
              style={{
                width: 420, maxWidth: "calc(100vw - 32px)",
                background: "var(--card)", border: "1px solid var(--border-hover)",
                borderRadius: 14, padding: 20,
                boxShadow: "0 24px 60px rgba(0,0,0,0.6)",
                display: "flex", flexDirection: "column", gap: 14,
              }}
            >
              <h2 style={{ margin: 0, fontSize: 20, color: "var(--text)" }}>Clear all tags?</h2>
              <p style={{ margin: 0, fontSize: 14, color: "var(--text-2)", lineHeight: 1.55 }}>
                This will remove every tag from all bookmarks. Bookmarks will remain in your library.
              </p>
              <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
                <button
                  onClick={() => setShowClearAllTags(false)}
                  style={{
                    height: 34, padding: "0 14px",
                    borderRadius: 8, border: "1px solid var(--border-hover)",
                    background: "var(--card)", color: "var(--text-2)",
                    cursor: "pointer", fontSize: 13, fontWeight: 600,
                  }}
                >
                  Cancel
                </button>
                <button
                  onClick={() => {
                    replaceBookmarks(bookmarks.map((b) => ({ ...b, tags: [] })));
                    setSelectedTag(null);
                    setShowClearAllTags(false);
                  }}
                  style={{
                    height: 34, padding: "0 14px",
                    borderRadius: 8, border: "1px solid #ef4444",
                    background: "#ef4444", color: "#fff",
                    cursor: "pointer", fontSize: 13, fontWeight: 700,
                  }}
                >
                  Clear Tags
                </button>
              </div>
            </div>
          </div>
        )}

        {pendingTagDelete && (
          <div
            onClick={() => setPendingTagDelete(null)}
            style={{
              position: "fixed", inset: 0, background: "rgba(0,0,0,0.65)",
              backdropFilter: "blur(4px)", display: "flex",
              alignItems: "center", justifyContent: "center", zIndex: 1000,
            }}
          >
            <div
              onClick={(e) => e.stopPropagation()}
              style={{
                background: "var(--card)", border: "1px solid #ef444440",
                borderRadius: 14, padding: 24, width: 340,
                display: "flex", flexDirection: "column", gap: 14,
                boxShadow: "0 24px 60px rgba(0,0,0,0.6)",
              }}
            >
              <h2 style={{ fontSize: 16, fontWeight: 700, color: "#ef4444", margin: 0 }}>
                Delete tag "{pendingTagDelete}"?
              </h2>
              <p style={{ fontSize: 13, color: "var(--text-2)", lineHeight: 1.6, margin: 0 }}>
                This will remove the tag from the sidebar and from all bookmarks currently using it.
              </p>
              <div style={{ display: "flex", gap: 8 }}>
                <button
                  onClick={() => setPendingTagDelete(null)}
                  style={{
                    flex: 1, background: "var(--border)", border: "1px solid var(--border-hover)",
                    borderRadius: 8, padding: "9px 0", color: "var(--text-2)",
                    fontSize: 13, fontWeight: 600, cursor: "pointer",
                  }}
                >
                  Cancel
                </button>
                <button
                  onClick={() => {
                    deleteTag(pendingTagDelete);
                    setCleanupBypassTags((prev) => prev.filter((t) => t !== pendingTagDelete));
                    if (selectedTag === pendingTagDelete) setSelectedTag(null);
                    setPendingTagDelete(null);
                  }}
                  style={{
                    flex: 1, background: "#ef4444", border: "none",
                    borderRadius: 8, padding: "9px 0", color: "#fff",
                    fontSize: 13, fontWeight: 700, cursor: "pointer",
                  }}
                >
                  Delete tag
                </button>
              </div>
            </div>
          </div>
        )}

        {cleanupResult && (
          <div
            onClick={() => setCleanupResult(null)}
            style={{
              position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)",
              backdropFilter: "blur(4px)", display: "flex",
              alignItems: "center", justifyContent: "center", zIndex: 1000,
            }}
          >
            <div
              onClick={(e) => e.stopPropagation()}
              style={{
                background: "var(--card)", border: "1px solid var(--border-hover)",
                borderRadius: 14, padding: 28, width: 340,
                display: "flex", flexDirection: "column", gap: 16,
                boxShadow: "0 24px 60px rgba(0,0,0,0.6)",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <span style={{ fontSize: 22 }}><BroomIcon /></span>
                <h2 style={{ fontSize: 16, fontWeight: 700, color: "var(--text)", margin: 0 }}>{t("cleanUpComplete")}</h2>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                <ResultRow icon="🗑️" label={t("duplicatesRemoved")} value={cleanupResult.removed} />
                <ResultRow icon="🔍" label={t("missingDescriptions")} value={`${cleanupResult.missingFixed} of ${cleanupResult.missingFound}`} dim={cleanupResult.missingFound === 0} />
                <ResultRow icon="🧩" label={t("notUnique")} value={cleanupResult.notUnique} />
                <ResultRow icon="⚠️" label={t("notReachable")} value={cleanupResult.notReachable} />
              </div>
              {cleanupResult.removed === 0 && cleanupResult.missingFound === 0 && cleanupResult.notUnique === 0 && cleanupResult.notReachable === 0 && (
                <p style={{ fontSize: 13, color: "var(--text-3)", margin: 0 }}>{t("everythingLooksClean")}</p>
              )}
              <button
                onClick={() => setCleanupResult(null)}
                style={{
                  background: "var(--border)", border: "1px solid var(--border-hover)",
                  borderRadius: 8, padding: "8px 0", color: "var(--text-2)",
                  fontSize: 13, cursor: "pointer", fontWeight: 600,
                }}
              >
                {t("done")}
              </button>
            </div>
          </div>
        )}
      </div>
    </>
  );
}

function ResultRow({ icon, label, value, dim }: { icon: string; label: string; value: number | string; dim?: boolean }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, opacity: dim && value === 0 ? 0.3 : 1 }}>
      <span style={{ fontSize: 16, width: 24, textAlign: "center" }}>{icon}</span>
      <span style={{ flex: 1, fontSize: 13, color: "var(--text-2)" }}>{label}</span>
      <span style={{ fontSize: 15, fontWeight: 700, color: (typeof value === "number" ? value > 0 : true) ? "var(--text)" : "var(--text-4)" }}>{value}</span>
    </div>
  );
}

// ── Small components ─────────────────────────────────────────────────────────

function TagChip({ label, count, active, color, onClick, onClear, vertical = false }: {
  label: string; count: number; active: boolean; color?: string; onClick: () => void; onClear?: () => void; vertical?: boolean;
}) {
  const c = color ?? "var(--text-2)";
  const [hovered, setHovered] = useState(false);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);
  const contextMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!contextMenu) return;
    const closeOnOutsideClick = (e: MouseEvent) => {
      if (!contextMenuRef.current) return;
      if (!contextMenuRef.current.contains(e.target as Node)) {
        setContextMenu(null);
      }
    };
    const closeOnEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape") setContextMenu(null);
    };
    const closeOnResize = () => setContextMenu(null);
    const closeOnScroll = () => setContextMenu(null);
    window.addEventListener("click", closeOnOutsideClick);
    window.addEventListener("resize", closeOnResize);
    window.addEventListener("scroll", closeOnScroll, true);
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      window.removeEventListener("click", closeOnOutsideClick);
      window.removeEventListener("resize", closeOnResize);
      window.removeEventListener("scroll", closeOnScroll, true);
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [contextMenu]);

  return (
    <div style={{ position: "relative" }}>
      <button
        onClick={onClick}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        onContextMenu={(e) => {
          if (!onClear) return;
          e.preventDefault();
          setContextMenu({ x: e.clientX, y: e.clientY });
        }}
        style={{
        display: "flex", alignItems: "center", gap: 8,
        padding: vertical ? "6px 12px" : "4px 10px",
        borderRadius: vertical ? 6 : 99,
        border: "none", cursor: "pointer",
        background: active || hovered ? (color ? color + "22" : "var(--border)") : "transparent",
        color: active ? (color ?? "var(--text)") : "var(--text-2)",
        fontSize: 13, fontWeight: active ? 600 : 400,
        whiteSpace: "nowrap", flexShrink: vertical ? undefined : 0,
        width: vertical ? "calc(100% - 16px)" : undefined,
        margin: vertical ? "1px 8px" : undefined,
        textAlign: "left",
        transition: "background 0.1s, color 0.1s",
      }}
      >
        {color
          ? <span style={{ width: 8, height: 8, borderRadius: "50%", background: c, display: "inline-block", flexShrink: 0 }} />
          : <span style={{ fontSize: 13 }}>◈</span>
        }
        <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{label}</span>
        <span style={{ marginLeft: "auto", fontSize: 11, color: "var(--text-4)", flexShrink: 0 }}>{count}</span>
      </button>

      {contextMenu && onClear && (
        <div
          ref={contextMenuRef}
          onClick={(e) => e.stopPropagation()}
          style={{
            position: "fixed",
            left: contextMenu.x,
            top: contextMenu.y,
            minWidth: 120,
            background: "var(--card)",
            border: "1px solid var(--border-hover)",
            borderRadius: 8,
            boxShadow: "0 10px 26px rgba(0,0,0,0.45)",
            padding: 4,
            zIndex: 3000,
          }}
        >
          <button
            onClick={() => {
              onClear();
              setContextMenu(null);
            }}
            style={tagContextMenuBtn}
          >
            Clear
          </button>
        </div>
      )}
    </div>
  );
}

function AppIcon({ app, width, height, radius }: { app: Pick<AppShortcut, "url" | "icon" | "iconUrl">; width: number; height: number; radius: number }) {
  const sources = appIconCandidates(app);
  const [idx, setIdx] = useState(0);
  const sourceKey = `${app.url}|${app.icon ?? ""}|${app.iconUrl ?? ""}`;

  useEffect(() => {
    queueMicrotask(() => setIdx(0));
  }, [sourceKey]);

  const src = sources[Math.min(idx, Math.max(0, sources.length - 1))] || faviconFromUrl(app.url);

  return (
    <span
      style={{
        width,
        height,
        borderRadius: radius,
        background: "#fff",
        flexShrink: 0,
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        overflow: "hidden",
      }}
    >
      <img
        src={src}
        alt=""
        width={width}
        height={height}
        style={{
          width: "100%",
          height: "100%",
          display: "block",
          objectFit: "contain",
          objectPosition: "center",
          maxWidth: "100%",
          maxHeight: "100%",
        }}
        onError={() => {
          setIdx((i) => Math.min(i + 1, sources.length - 1));
        }}
      />
    </span>
  );
}

function Divider() {
  return <div style={{ width: 1, height: 18, background: "var(--border)", flexShrink: 0 }} />;
}

function CleanupProgressRing({ percent }: { percent: number }) {
  const clamped = Math.max(0, Math.min(100, percent));
  const r = 5.5;
  const c = 2 * Math.PI * r;
  const offset = c - (clamped / 100) * c;

  return (
    <span title={`${clamped}%`} style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: 14, height: 14, position: "relative", lineHeight: 0 }}>
      <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
        <circle cx="7" cy="7" r={r} stroke="#3b82f644" strokeWidth="2" />
        <circle
          cx="7"
          cy="7"
          r={r}
          stroke="#3b82f6"
          strokeWidth="2"
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={offset}
          transform="rotate(-90 7 7)"
        />
      </svg>
      <span
        style={{
          position: "absolute",
          width: 4,
          height: 4,
          borderRadius: "50%",
          background: "#60a5fa",
          boxShadow: "0 0 8px #3b82f6aa",
          animation: "pulseBlue 1s ease-in-out infinite",
        }}
      />
    </span>
  );
}

function ToggleGroup({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ display: "flex", background: "var(--card)", border: "1px solid var(--border)", borderRadius: 7, overflow: "hidden" }}>
      {children}
    </div>
  );
}

function ToggleBtn({ active, onClick, title, icon, disabled }: {
  active: boolean; onClick: () => void; title: string; icon: React.ReactNode; disabled?: boolean;
}) {
  return (
    <button onClick={onClick} title={title} disabled={disabled} style={{
      display: "flex", alignItems: "center", justifyContent: "center",
      padding: "5px 9px", background: active ? "var(--border-hover)" : "transparent",
      border: "none", color: disabled ? "var(--text-4)" : active ? "var(--text)" : "var(--text-3)",
      cursor: disabled ? "not-allowed" : "pointer",
      transition: "background 0.1s, color 0.1s",
      opacity: disabled ? 0.5 : 1,
    }}>
      {icon}
    </button>
  );
}


function Empty({ onAdd }: { onAdd: () => void }) {
  return (
    <div style={{ textAlign: "center", color: "var(--text-4)", marginTop: 80 }}>
      <div style={{ fontSize: 15, marginBottom: 12 }}>No bookmarks found</div>
      <button onClick={onAdd} style={{
        background: "#3b82f620", border: "1px solid #3b82f640",
        borderRadius: 8, color: "#3b82f6", fontSize: 13, padding: "7px 16px", cursor: "pointer",
      }}>
        Add your first bookmark
      </button>
    </div>
  );
}

function SmallGridIcon({ size }: { size: number }) {
  const s = size * 0.38;
  const g = size * 0.08;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} fill="var(--text-3)">
      <rect x={0} y={0} width={s} height={s} rx={1} />
      <rect x={s + g} y={0} width={s} height={s} rx={1} />
      <rect x={0} y={s + g} width={s} height={s} rx={1} />
      <rect x={s + g} y={s + g} width={s} height={s} rx={1} />
    </svg>
  );
}

// Icons
function IconTile() {
  return (
    <svg width="15" height="15" viewBox="0 0 15 15" fill="currentColor">
      <rect x="0" y="0" width="6" height="6" rx="1.5" />
      <rect x="8" y="0" width="6" height="6" rx="1.5" />
      <rect x="0" y="8" width="6" height="6" rx="1.5" />
      <rect x="8" y="8" width="6" height="6" rx="1.5" />
    </svg>
  );
}

function IconTable() {
  return (
    <svg width="15" height="15" viewBox="0 0 15 15" fill="currentColor">
      <rect x="0" y="1" width="15" height="2" rx="1" />
      <rect x="0" y="6" width="15" height="2" rx="1" />
      <rect x="0" y="11" width="15" height="2" rx="1" />
    </svg>
  );
}


function IconPreview() {
  return (
    <svg width="13" height="13" viewBox="0 0 13 13" fill="currentColor">
      <rect x="0" y="0" width="13" height="9" rx="2" opacity="0.4" />
      <rect x="0" y="0" width="13" height="5.5" rx="2" />
      <rect x="0" y="10.5" width="5" height="1.5" rx="0.75" />
      <rect x="0" y="10.5" width="8" height="1.5" rx="0.75" opacity="0.4" />
    </svg>
  );
}

function IconCalendar() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="4" width="18" height="17" rx="3" />
      <line x1="8" y1="2.5" x2="8" y2="6" />
      <line x1="16" y1="2.5" x2="16" y2="6" />
      <line x1="3" y1="9" x2="21" y2="9" />
      <line x1="8" y1="13" x2="8" y2="13" />
      <line x1="12" y1="13" x2="12" y2="13" />
      <line x1="16" y1="13" x2="16" y2="13" />
      <line x1="8" y1="17" x2="8" y2="17" />
      <line x1="12" y1="17" x2="12" y2="17" />
      <line x1="16" y1="17" x2="16" y2="17" />
    </svg>
  );
}

function IconSun() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="5" fill="none" />
      <line x1="12" y1="1" x2="12" y2="3" />
      <line x1="12" y1="21" x2="12" y2="23" />
      <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" />
      <line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
      <line x1="1" y1="12" x2="3" y2="12" />
      <line x1="21" y1="12" x2="23" y2="12" />
      <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" />
      <line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
    </svg>
  );
}

function IconMoon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
    </svg>
  );
}

function IconCollapseTabs() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.7" strokeLinecap="round" strokeLinejoin="round">
      <path d="M19 5L5 19" />
      <path d="M11 19H5V13" />
    </svg>
  );
}

function IconExpandTabs() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.7" strokeLinecap="round" strokeLinejoin="round">
      <path d="M5 19L19 5" />
      <path d="M13 5H19V11" />
    </svg>
  );
}

function SidebarTagRow({ tag, count, active, onSelect, onRename, onDelete, onClear, cleanupBypassed, onToggleCleanupBypass, onChangeColor, onBookmarkDrop, onTagReorder }: {
  tag: string; count: number; active: boolean;
  onSelect: () => void;
  onRename: (newName: string) => void;
  onDelete: () => void;
  onClear: () => void;
  cleanupBypassed: boolean;
  onToggleCleanupBypass: () => void;
  onChangeColor: () => void;
  onBookmarkDrop: (bookmarkId: string) => void;
  onTagReorder: (draggedTag: string, targetTag: string) => void;
}) {
  const [hovered, setHovered] = useState(false);
  const [editing, setEditing] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);
  const contextMenuRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const skipSave = useRef(false);
  const c = tagColor(tag);

  useEffect(() => {
    if (!contextMenu) return;
    const closeOnOutsideClick = (e: MouseEvent) => {
      if (!contextMenuRef.current) return;
      if (!contextMenuRef.current.contains(e.target as Node)) {
        setContextMenu(null);
      }
    };
    const closeOnEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape") setContextMenu(null);
    };
    const closeOnResize = () => setContextMenu(null);
    const closeOnScroll = () => setContextMenu(null);
    window.addEventListener("click", closeOnOutsideClick);
    window.addEventListener("resize", closeOnResize);
    window.addEventListener("scroll", closeOnScroll, true);
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      window.removeEventListener("click", closeOnOutsideClick);
      window.removeEventListener("resize", closeOnResize);
      window.removeEventListener("scroll", closeOnScroll, true);
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [contextMenu]);

  const handleSave = () => {
    if (skipSave.current) { skipSave.current = false; return; }
    const val = inputRef.current?.value?.trim() ?? "";
    onRename(val);
    setEditing(false);
  };

  if (editing) {
    return (
      <div style={{ margin: "1px 8px", display: "flex", alignItems: "center", gap: 4 }}>
        <input
          ref={inputRef}
          autoFocus
          defaultValue={tag}
          onKeyDown={(e) => {
            if (e.key === "Enter") handleSave();
            if (e.key === "Escape") { skipSave.current = true; setEditing(false); }
          }}
          onBlur={handleSave}
          style={{
            flex: 1, background: "var(--bg)", border: "1px solid #3b82f6",
            borderRadius: 6, padding: "4px 8px", color: "var(--text)", fontSize: 13, outline: "none",
          }}
        />
      </div>
    );
  }

  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => { setHovered(false); }}
      onContextMenu={(e) => {
        e.preventDefault();
        setContextMenu({ x: e.clientX, y: e.clientY });
      }}
      draggable={!editing}
      onDragStart={(e) => {
        e.dataTransfer.effectAllowed = "move";
        e.dataTransfer.setData(TAG_DRAG_MIME, tag);
      }}
      onDragOver={(e) => {
        const hasBookmarkData = e.dataTransfer.types.includes(BOOKMARK_DRAG_MIME);
        const hasTagData = e.dataTransfer.types.includes(TAG_DRAG_MIME);
        if (!hasBookmarkData && !hasTagData) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
        setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragOver(false);
        const draggedTag = e.dataTransfer.getData(TAG_DRAG_MIME);
        if (draggedTag) {
          onTagReorder(draggedTag, tag);
          return;
        }
        const directId = e.dataTransfer.getData(BOOKMARK_DRAG_MIME);
        const plain = e.dataTransfer.getData("text/plain");
        const fallbackId = plain.startsWith(BOOKMARK_DRAG_FALLBACK_PREFIX)
          ? plain.slice(BOOKMARK_DRAG_FALLBACK_PREFIX.length)
          : "";
        const bookmarkId = directId || fallbackId;
        if (!bookmarkId) return;
        onBookmarkDrop(bookmarkId);
      }}
      style={{
        display: "flex", alignItems: "center",
        width: "calc(100% - 16px)", margin: "1px 8px", borderRadius: 6,
        background: dragOver ? c + "33" : (active || hovered) ? c + "22" : "transparent",
        transition: "background 0.1s",
      }}
    >
      <button
        onClick={onSelect}
        style={{
          flex: 1, display: "flex", alignItems: "center", gap: 8,
          padding: "6px 8px", background: "none", border: "none",
          color: active ? c : hovered ? "var(--text)" : "var(--text-2)",
          fontSize: 13, fontWeight: active ? 600 : 400,
          cursor: "pointer", textAlign: "left", overflow: "hidden",
          transition: "color 0.1s",
        }}
      >
        <span style={{ width: 8, height: 8, borderRadius: "50%", background: c, flexShrink: 0, display: "inline-block" }} />
        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1 }}>{tag}</span>
        <span style={{ fontSize: 11, color: "var(--text-4)", flexShrink: 0 }}>{count}</span>
      </button>

      {contextMenu && (
        <div
          ref={contextMenuRef}
          onClick={(e) => e.stopPropagation()}
          style={{
            position: "fixed",
            left: contextMenu.x,
            top: contextMenu.y,
            minWidth: 138,
            background: "var(--card)",
            border: "1px solid var(--border-hover)",
            borderRadius: 8,
            boxShadow: "0 10px 26px rgba(0,0,0,0.45)",
            padding: 4,
            zIndex: 3000,
          }}
        >
          <button
            onClick={() => {
              onChangeColor();
              setContextMenu(null);
            }}
            style={tagContextMenuBtn}
          >
            Change Color
          </button>
          <button
            onClick={() => {
              setEditing(true);
              setContextMenu(null);
            }}
            style={tagContextMenuBtn}
          >
            Rename Tag
          </button>
          <button
            onClick={() => {
              onClear();
              setContextMenu(null);
            }}
            style={tagContextMenuBtn}
          >
            Clear Tag
          </button>
          <button
            onClick={() => {
              onToggleCleanupBypass();
              setContextMenu(null);
            }}
            style={{
              ...tagContextMenuBtn,
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
            }}
          >
            <span>Bypass Clean Up</span>
            <span style={{ width: 16, textAlign: "right" }}>{cleanupBypassed ? "✓" : ""}</span>
          </button>
          <div style={{ height: 1, background: "var(--border)", margin: "4px 0" }} />
          <button
            onClick={() => {
              onDelete();
              setContextMenu(null);
            }}
            style={tagContextMenuBtn}
          >
            Delete Tag
          </button>
        </div>
      )}
    </div>
  );
}

const tagContextMenuBtn: React.CSSProperties = {
  display: "block",
  width: "100%",
  textAlign: "left",
  padding: "7px 10px",
  border: "none",
  borderRadius: 6,
  background: "none",
  color: "var(--text-2)",
  fontSize: 13,
  cursor: "pointer",
};

const appContextMenuBtn: React.CSSProperties = {
  display: "block",
  width: "100%",
  textAlign: "left",
  padding: "7px 10px",
  border: "none",
  borderRadius: 6,
  background: "none",
  color: "var(--text-2)",
  fontSize: 13,
  cursor: "pointer",
};

function DataMenuItem({ icon, label, onClick, disabled, danger }: { icon: React.ReactNode; label: string; onClick: () => void; disabled?: boolean; danger?: boolean }) {
  const [hovered, setHovered] = useState(false);
  const color = disabled ? "var(--text-4)" : danger ? "#ef4444" : "var(--text-2)";
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        display: "flex", alignItems: "center", gap: 10,
        width: "100%", padding: "7px 14px",
        background: hovered ? (danger ? "#ef444420" : "var(--border)") : "none",
        border: "none", color,
        fontSize: 13, cursor: disabled ? "not-allowed" : "pointer",
        textAlign: "left",
      }}
    >
      <span style={{ width: 18, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14 }}>{icon}</span>
      {label}
    </button>
  );
}

function BroomIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 21l9-9" />
      <path d="M12.5 2.5l9 9-3.5 3.5-2-2-3 3-2-2 3-3-2-2z" />
      <path d="M6 18c-1.5 1-3 1.5-4 1 .5-1 1-2.5 2-4" />
    </svg>
  );
}

function IconSidebar({ flipped }: { flipped?: boolean }) {
  return (
    <svg width="15" height="15" viewBox="0 0 15 15" fill="currentColor"
      style={{ transform: flipped ? "scaleX(-1)" : "none", transition: "transform 0.22s ease" }}>
      <rect x="1" y="1" width="13" height="13" rx="2" opacity="0.25" />
      <rect x="1" y="1" width="4" height="13" rx="2" />
      <rect x="7" y="4" width="5" height="1.5" rx="0.75" opacity="0.6" />
      <rect x="7" y="7" width="5" height="1.5" rx="0.75" opacity="0.6" />
      <rect x="7" y="10" width="3" height="1.5" rx="0.75" opacity="0.6" />
    </svg>
  );
}
