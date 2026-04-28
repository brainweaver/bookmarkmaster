import { useState, useMemo, useEffect, useRef, useCallback } from "react";
import BookmarkCard from "./components/BookmarkCard";
import TimelineView from "./components/TimelineView";
import ListView from "./components/ListView";
import BookmarkModal from "./components/BookmarkModal";
import ImportExportModal from "./components/ImportExportModal";
import { cycleTagColor, tagColor } from "./utils/tagColors";
import { useBookmarks } from "./hooks/useBookmarks";
import { fetchMeta, resolveReachability } from "./utils/fetchMeta";
import { localDateKey } from "./utils/date";
import { SYSTEM_TAG_ARCHIVED, SYSTEM_TAG_NOT_REACHABLE, SYSTEM_TAG_NOT_UNIQUE, visibleTags } from "./constants/tags";
import { APP_VERSION } from "./config/app";
import type { Bookmark } from "./data/mockBookmarks";
import { t } from "./i18n";
import {
  APP_CATALOG_KEY,
  APP_SHORTCUTS_KEY,
  TRIAL_START_KEY,
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
const ARCHIVED_FILTER = SYSTEM_TAG_ARCHIVED;
const NOT_UNIQUE_FILTER = SYSTEM_TAG_NOT_UNIQUE;
const NOT_REACHABLE_FILTER = SYSTEM_TAG_NOT_REACHABLE;
const BOOKMARK_DRAG_MIME = "application/x-bookmark-id";
const BOOKMARK_SELECTION_DRAG_MIME = "application/x-bookmark-selection";
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
const TRIAL_DURATION_DAYS = 14;
const TRIAL_DURATION_MS = TRIAL_DURATION_DAYS * 24 * 60 * 60 * 1000;

function formatTrialLabel(daysLeft: number, ended: boolean): string {
  if (ended) return "Trial Ended";
  return `${daysLeft} Day Trial`;
}

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
  | { mode: "add"; prefill?: { url: string; title: string; favicon: string; description?: string; tags?: string[] } }
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

function nextTheme(current: ThemeId): ThemeId {
  const idx = THEME_CYCLE.indexOf(current);
  return THEME_CYCLE[(idx + 1) % THEME_CYCLE.length];
}

function formatThemeLabel(theme: string): string {
  return theme
    .split("-")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
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
  const [themeMenuOpen, setThemeMenuOpen] = useState(false);
  const [displayMode, setDisplayMode] = useState<DisplayMode>(loadDisplayMode);
  const [groupByDate, setGroupByDate] = useState(loadGroupByDate);
  const [zoom, setZoom] = useState(loadZoom);

  const [selectedTag, setSelectedTag] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [sortBy, setSortBy] = useState<SortBy>(loadSortBy);
  const [rankOrder, setRankOrder] = useState<string[]>(loadRankOrder);
  const rankOrderHydratedRef = useRef(false);
  const sidebarTagInitialSelectionRef = useRef(false);
  const [modal, setModal] = useState<ModalState>({ mode: "closed" });
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
  const [selectedBookmarkIds, setSelectedBookmarkIds] = useState<string[]>([]);
  const [bookmarkSelectionDrag, setBookmarkSelectionDrag] = useState<{
    startX: number;
    startY: number;
    currentX: number;
    currentY: number;
  } | null>(null);
  const bookmarkSelectionDragRef = useRef<typeof bookmarkSelectionDrag>(null);
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
  const themeMenuRef = useRef<HTMLDivElement>(null);
  const mainContentRef = useRef<HTMLDivElement>(null);
  const restoreFileRef = useRef<HTMLInputElement>(null);
  const [showDeleteAll, setShowDeleteAll] = useState(false);
  const [showClearAllTags, setShowClearAllTags] = useState(false);
  const [pendingTagDelete, setPendingTagDelete] = useState<string | null>(null);
  const [, setTagColorVersion] = useState(0);
  const [tagOrder, setTagOrder] = useState<string[]>(loadTagOrder);
  const [cleanupBypassTags, setCleanupBypassTags] = useState<string[]>(loadCleanupBypassTags);
  const [sidebarTagContextMenu, setSidebarTagContextMenu] = useState<{ tag: string; x: number; y: number; openUp: boolean } | null>(null);
  const [sidebarTagEditMode, setSidebarTagEditMode] = useState(false);
  const [selectedSidebarTags, setSelectedSidebarTags] = useState<string[]>([]);
  const [pendingBulkDeleteTags, setPendingBulkDeleteTags] = useState<string[] | null>(null);
  const [pendingTagClear, setPendingTagClear] = useState<string | null>(null);
  const [pendingTagBookmarkDelete, setPendingTagBookmarkDelete] = useState<{ tag: string; count: number } | null>(null);
  const [pendingMoveBookmarks, setPendingMoveBookmarks] = useState<string | null>(null);
  const [moveBookmarksSearch, setMoveBookmarksSearch] = useState("");
  const [moveBookmarksNewTag, setMoveBookmarksNewTag] = useState("");
  const [pendingSearchTagAssign, setPendingSearchTagAssign] = useState<string[] | null>(null);
  const [searchTagSearch, setSearchTagSearch] = useState("");
  const [appCatalog, setAppCatalog] = useState<AppGroup[]>(loadAppCatalog);
  const [appShortcuts, setAppShortcuts] = useState<AppShortcut[]>(loadAppShortcuts);
  const [showAppPicker, setShowAppPicker] = useState(false);
  const [appSearch, setAppSearch] = useState("");
  const [appPickerSelection, setAppPickerSelection] = useState<string[]>([]);
  const [showAllApps, setShowAllApps] = useState(false);
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
  const [pendingAppDelete, setPendingAppDelete] = useState<AppShortcut | null>(null);
  const appContextMenuRef = useRef<HTMLDivElement>(null);
  const [appDraggingId, setAppDraggingId] = useState<string | null>(null);
  const [appDragReadyId, setAppDragReadyId] = useState<string | null>(null);
  const appDragHoverTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [appPickerError, setAppPickerError] = useState<string | null>(null);
  const [trialStartAt, setTrialStartAt] = useState<number | null>(null);
  const [trialReady, setTrialReady] = useState(false);
  const [trialNow, setTrialNow] = useState(() => Date.now());
  const [showTrialModal, setShowTrialModal] = useState(false);
  const [pendingDuplicate, setPendingDuplicate] = useState<{
    title: string;
    url: string;
    mode: "bookmark" | "drop";
  } | null>(null);
  const pendingDuplicateResolveRef = useRef<((confirmed: boolean) => void) | null>(null);

  // When opened via extension toolbar click or context menu, URL params carry
  // the originating tab's info — auto-open the add modal with it prefilled.
  const effectiveSelectedTag =
    selectedTag === NOT_TAGGED_FILTER || selectedTag === NOT_UNIQUE_FILTER || selectedTag === NOT_REACHABLE_FILTER
      ? null
      : selectedTag;
  const themeLabel = formatThemeLabel(theme);
  const filteredAppCatalog = useMemo(() => {
    const query = appSearch.trim().toLowerCase();
    if (!query) return appCatalog;
    return appCatalog
      .map((group) => ({
        ...group,
        apps: group.apps.filter((app) => app.name.toLowerCase().includes(query)),
      }))
      .filter((group) => group.apps.length > 0);
  }, [appCatalog, appSearch]);
  const orderedSidebarTags = useMemo(() => {
    const orderedExisting = tagOrder.filter((t) => allTags.includes(t));
    const remaining = allTags.filter((t) => !orderedExisting.includes(t));
    return [...orderedExisting, ...remaining];
  }, [allTags, tagOrder]);
  const visibleAppShortcuts = useMemo(
    () => (showAllApps || appShortcuts.length <= 20 ? appShortcuts : appShortcuts.slice(0, 20)),
    [appShortcuts, showAllApps],
  );
  const trialRemainingMs = trialStartAt === null ? null : trialStartAt + TRIAL_DURATION_MS - trialNow;
  // TODO: once licensing is finalized, use `trialEnded` to gate write actions
  // (add/edit/delete/move/tag/import) while keeping view/search/export available.
  const trialEnded = trialReady && trialRemainingMs !== null && trialRemainingMs <= 0;
  const trialDaysLeft = trialRemainingMs !== null ? Math.max(0, Math.ceil(trialRemainingMs / (24 * 60 * 60 * 1000))) : TRIAL_DURATION_DAYS;
  const trialLabel = trialReady ? formatTrialLabel(trialDaysLeft, trialEnded) : "Loading...";
  const isDarkTheme = theme === "dark" || theme === "midnight" || theme === "black" || theme === "graphite" || theme === "high-contrast" || theme.includes("night");
  const trialBadgeTextColor = isDarkTheme ? "#1d4ed8" : "#1d4ed8";
  const trialBadgeBorder = trialEnded
    ? "var(--border-hover)"
    : !isDarkTheme
      ? "rgba(37, 99, 235, 0.28)"
      : "#93c5fd";
  const trialBadgeBackground = trialEnded
    ? "var(--card)"
    : !isDarkTheme
      ? "rgba(37, 99, 235, 0.08)"
      : "#e0f2fe";
  const trialModalIconBackground = isDarkTheme ? "rgba(59,130,246,0.14)" : "rgba(37, 99, 235, 0.10)";
  const trialModalIconColor = isDarkTheme ? "#93c5fd" : "#1d4ed8";

  useEffect(() => {
    if (sidebarTagInitialSelectionRef.current) return;
    if (selectedTag !== null) return;
    const firstTag = orderedSidebarTags[0];
    if (!firstTag) return;
    sidebarTagInitialSelectionRef.current = true;
    setSelectedTag(firstTag);
  }, [orderedSidebarTags, selectedTag]);

  const promptDuplicateOverwrite = useCallback((title: string, url: string, mode: "bookmark" | "drop") => {
    if (pendingDuplicateResolveRef.current) {
      pendingDuplicateResolveRef.current(false);
      pendingDuplicateResolveRef.current = null;
    }
    return new Promise<boolean>((resolve) => {
      pendingDuplicateResolveRef.current = resolve;
      setPendingDuplicate({ title, url, mode });
    });
  }, []);

  const settleDuplicateOverwrite = useCallback((confirmed: boolean) => {
    pendingDuplicateResolveRef.current?.(confirmed);
    pendingDuplicateResolveRef.current = null;
    setPendingDuplicate(null);
  }, []);

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
    if (!themeMenuOpen) return;
    const closeOnOutsideClick = (e: MouseEvent) => {
      if (!themeMenuRef.current) return;
      if (!themeMenuRef.current.contains(e.target as Node)) {
        setThemeMenuOpen(false);
      }
    };
    const closeOnEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape") setThemeMenuOpen(false);
    };
    window.addEventListener("click", closeOnOutsideClick);
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      window.removeEventListener("click", closeOnOutsideClick);
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [themeMenuOpen]);

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

  useEffect(() => {
    let cancelled = false;
    const finish = (startAt: number) => {
      if (cancelled) return;
      setTrialStartAt(startAt);
      setTrialReady(true);
    };

    if (typeof chrome !== "undefined" && chrome.storage?.local) {
      chrome.storage.local.get([TRIAL_START_KEY], (items) => {
        const raw = items[TRIAL_START_KEY];
        if (typeof raw === "number" && Number.isFinite(raw)) {
          finish(raw);
          return;
        }
        const now = Date.now();
        chrome.storage.local.set({ [TRIAL_START_KEY]: now }, () => finish(now));
      });
    } else {
      const raw = persistenceGetItem(TRIAL_START_KEY);
      const parsed = raw ? Number(raw) : NaN;
      const now = Number.isFinite(parsed) ? parsed : Date.now();
      if (!Number.isFinite(parsed)) persistenceSetItem(TRIAL_START_KEY, String(now));
      finish(now);
    }

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!trialReady) return;
    const timer = window.setInterval(() => setTrialNow(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, [trialReady]);

  const filtered = useMemo(() => {
    const tokens = search.trim().toLowerCase().split(/\s+/).filter(Boolean);
    const tagTokens = tokens.filter((t) => t.startsWith("#")).map((t) => t.slice(1));
    const textTokens = tokens.filter((t) => !t.startsWith("#"));

    return bookmarks.filter((b) => {
      const userTags = visibleTags(b.tags);
      const isArchived = b.tags.includes(ARCHIVED_FILTER);
      if (selectedTag === NOT_TAGGED_FILTER && userTags.length > 0) return false;
      if (selectedTag === NOT_UNIQUE_FILTER && !b.tags.includes(SYSTEM_TAG_NOT_UNIQUE)) return false;
      if (selectedTag === NOT_REACHABLE_FILTER && !b.tags.includes(SYSTEM_TAG_NOT_REACHABLE)) return false;
      if (selectedTag === ARCHIVED_FILTER && !isArchived) return false;
      if (selectedTag !== ARCHIVED_FILTER && isArchived) return false;
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

  const handleSave = async (data: Omit<Bookmark, "id" | "addedAt">) => {
    if (modal.mode === "add") {
      const incomingKey = normaliseUrlForDedupe(data.url);
      const existing = bookmarks.find((b) => normaliseUrlForDedupe(b.url) === incomingKey);
      if (existing) {
        const confirmed = await promptDuplicateOverwrite(existing.title, existing.url, "bookmark");
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
    if (
      e.dataTransfer.types.includes(BOOKMARK_DRAG_MIME) ||
      e.dataTransfer.types.includes(BOOKMARK_SELECTION_DRAG_MIME) ||
      e.dataTransfer.types.includes(TAG_DRAG_MIME)
    ) return;
    e.preventDefault();
    setDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragging(false);
  };

  const [dropResult, setDropResult] = useState<string | null>(null);

  const handleDrop = async (e: React.DragEvent) => {
    if (
      e.dataTransfer.types.includes(BOOKMARK_DRAG_MIME) ||
      e.dataTransfer.types.includes(BOOKMARK_SELECTION_DRAG_MIME) ||
      e.dataTransfer.types.includes(TAG_DRAG_MIME)
    ) {
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

        const confirmed = await promptDuplicateOverwrite(existing.title, existing.url, "drop");
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
        : selectedTag === ARCHIVED_FILTER
        ? "Archived"
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
    if (selectedBookmarkIds.includes(bookmarkId) && selectedBookmarkIds.length > 1) {
      e.dataTransfer.setData(BOOKMARK_SELECTION_DRAG_MIME, JSON.stringify(selectedBookmarkIds));
      e.dataTransfer.setData("text/plain", `bookmark-selection:${bookmarkId}`);
      return;
    }
    e.dataTransfer.setData(BOOKMARK_DRAG_MIME, bookmarkId);
    e.dataTransfer.setData("text/plain", `${BOOKMARK_DRAG_FALLBACK_PREFIX}${bookmarkId}`);
  };

  const handleBookmarkSelectionStart = (e: React.MouseEvent<HTMLDivElement>) => {
    if (displayMode === "list") return;
    if (e.button !== 0) return;
    const target = e.target as HTMLElement | null;
    if (target?.closest("[data-bookmark-id], a, button, input, textarea, select, [role='button']")) return;
    if (!mainContentRef.current) return;
    setBookmarkSelectionDrag({
      startX: e.clientX,
      startY: e.clientY,
      currentX: e.clientX,
      currentY: e.clientY,
    });
  };

  useEffect(() => {
    bookmarkSelectionDragRef.current = bookmarkSelectionDrag;
  }, [bookmarkSelectionDrag]);

  useEffect(() => {
    if (!bookmarkSelectionDrag) return;
    const handleMove = (e: MouseEvent) => {
      setBookmarkSelectionDrag((prev) => {
        if (!prev) return prev;
        const next = { ...prev, currentX: e.clientX, currentY: e.clientY };
        bookmarkSelectionDragRef.current = next;
        return next;
      });
    };
    const handleUp = () => {
      const rect = mainContentRef.current;
      const drag = bookmarkSelectionDragRef.current;
      if (!rect) {
        setBookmarkSelectionDrag(null);
        return;
      }
      if (!drag) {
        setBookmarkSelectionDrag(null);
        return;
      }
      const left = Math.min(drag.startX, drag.currentX);
      const right = Math.max(drag.startX, drag.currentX);
      const top = Math.min(drag.startY, drag.currentY);
      const bottom = Math.max(drag.startY, drag.currentY);
      const ids = Array.from(rect.querySelectorAll<HTMLElement>("[data-bookmark-id]"))
        .filter((el) => {
          const box = el.getBoundingClientRect();
          return box.left < right && box.right > left && box.top < bottom && box.bottom > top;
        })
        .map((el) => el.dataset.bookmarkId || "")
        .filter(Boolean);
      setSelectedBookmarkIds(ids);
      bookmarkSelectionDragRef.current = null;
      setBookmarkSelectionDrag(null);
    };
    window.addEventListener("mousemove", handleMove);
    window.addEventListener("mouseup", handleUp);
    return () => {
      window.removeEventListener("mousemove", handleMove);
      window.removeEventListener("mouseup", handleUp);
    };
  }, [bookmarkSelectionDrag]);

  const getDraggedBookmarkId = (e: React.DragEvent): string => {
    const selectionRaw = e.dataTransfer.getData(BOOKMARK_SELECTION_DRAG_MIME);
    if (selectionRaw) {
      try {
        const parsed = JSON.parse(selectionRaw) as unknown;
        if (Array.isArray(parsed)) {
          const first = parsed.map((id) => String(id)).find(Boolean);
          if (first) return first;
        }
      } catch {
        // Fall through to single-item drag data.
      }
    }
    const directId = e.dataTransfer.getData(BOOKMARK_DRAG_MIME);
    const plain = e.dataTransfer.getData("text/plain");
    const fallbackId = plain.startsWith(BOOKMARK_DRAG_FALLBACK_PREFIX)
      ? plain.slice(BOOKMARK_DRAG_FALLBACK_PREFIX.length)
      : "";
    return directId || fallbackId;
  };

  const handleBookmarkDropOnTag = (bookmarkIds: string | string[], tag: string) => {
    const ids = Array.isArray(bookmarkIds) ? bookmarkIds : [bookmarkIds];
    if (ids.length === 0) return;
    const sourceTag =
      selectedTag &&
      selectedTag !== NOT_TAGGED_FILTER &&
      selectedTag !== NOT_UNIQUE_FILTER &&
      selectedTag !== NOT_REACHABLE_FILTER &&
      selectedTag !== ARCHIVED_FILTER
        ? selectedTag
        : null;
    if (sourceTag === tag) return;
    replaceBookmarks(
      bookmarks.map((b) => {
        if (!ids.includes(b.id)) return b;
        const nextTags = b.tags.filter((t) => t !== ARCHIVED_FILTER && t !== sourceTag);
        if (!nextTags.includes(tag)) nextTags.push(tag);
        return { ...b, tags: nextTags };
      })
    );
    if (selectedBookmarkIds.some((id) => ids.includes(id))) {
      setSelectedBookmarkIds([]);
    }
  };

  const handleArchiveBookmark = (bookmarkId: string, sourceTag: string | null = selectedTag) => {
    replaceBookmarks(
      bookmarks.map((b) => {
        if (b.id !== bookmarkId) return b;
        const isArchived = b.tags.includes(ARCHIVED_FILTER);
        const activeSourceTag =
          sourceTag &&
          sourceTag !== null &&
          sourceTag !== ARCHIVED_FILTER &&
          sourceTag !== NOT_TAGGED_FILTER &&
          sourceTag !== NOT_UNIQUE_FILTER &&
          sourceTag !== NOT_REACHABLE_FILTER
            ? sourceTag
            : null;
        const nextTags = isArchived
          ? b.tags.filter((t) => t !== ARCHIVED_FILTER)
          : [
              ...b.tags.filter((t) => t !== ARCHIVED_FILTER && t !== activeSourceTag),
              ARCHIVED_FILTER,
            ];
        return { ...b, tags: Array.from(new Set(nextTags)) };
      })
    );
  };

  const handleMoveBookmarksBetweenTags = (sourceTag: string, count: number) => {
    if (count === 0) {
      setDropResult("This tag has no bookmarks");
      setTimeout(() => setDropResult(null), 3000);
      return;
    }
    setPendingMoveBookmarks(sourceTag);
    setMoveBookmarksSearch("");
    setMoveBookmarksNewTag("");
  };

  const applySearchTagToBookmarks = (targetTag: string) => {
    if (!pendingSearchTagAssign || pendingSearchTagAssign.length === 0) return;
    if (!targetTag) return;
    const targetSet = new Set(pendingSearchTagAssign);
    replaceBookmarks(
      bookmarks.map((b) => {
        if (!targetSet.has(b.id)) return b;
        if (b.tags.includes(targetTag)) return b;
        return { ...b, tags: [...b.tags, targetTag] };
      })
    );
    setPendingSearchTagAssign(null);
    setSearchTagSearch("");
  };

  const createAndApplySearchTag = () => {
    const targetTag = normalizeTagName(searchTagSearch);
    if (!targetTag) return;
    addTag(targetTag);
    applySearchTagToBookmarks(targetTag);
  };

  const applyMoveBookmarksToTag = (sourceTag: string, targetTag: string) => {
    if (!targetTag || targetTag === sourceTag || targetTag === ARCHIVED_FILTER) return;
    replaceBookmarks(
      bookmarks.map((b) => {
        if (!b.tags.includes(sourceTag)) return b;
        const nextTags = b.tags.filter((t) => t !== sourceTag);
        if (!nextTags.includes(targetTag)) nextTags.push(targetTag);
        return { ...b, tags: nextTags };
      })
    );
    if (selectedTag === sourceTag) setSelectedTag(targetTag);
  };

  const confirmMoveBookmarksTarget = (targetTag: string) => {
    if (!pendingMoveBookmarks) return;
    applyMoveBookmarksToTag(pendingMoveBookmarks, targetTag);
    setPendingMoveBookmarks(null);
    setMoveBookmarksSearch("");
    setMoveBookmarksNewTag("");
  };

  const createAndMoveBookmarksTarget = () => {
    if (!pendingMoveBookmarks) return;
    const targetTag = normalizeTagName(moveBookmarksNewTag);
    if (!targetTag || targetTag === pendingMoveBookmarks || targetTag === ARCHIVED_FILTER) return;
    addTag(targetTag);
    applyMoveBookmarksToTag(pendingMoveBookmarks, targetTag);
    setPendingMoveBookmarks(null);
    setMoveBookmarksSearch("");
    setMoveBookmarksNewTag("");
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

  const exitSidebarTagEditMode = () => {
    setSidebarTagEditMode(false);
    setSelectedSidebarTags([]);
    setSidebarTagContextMenu(null);
  };

  const toggleSidebarTagEditMode = () => {
    setSidebarTagContextMenu(null);
    setSidebarTagEditMode((prev) => {
      const next = !prev;
      if (!next) setSelectedSidebarTags([]);
      return next;
    });
  };

  const toggleSelectedSidebarTag = (tag: string) => {
    setSelectedSidebarTags((prev) =>
      prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag]
    );
  };

  const confirmBulkDeleteSidebarTags = () => {
    if (selectedSidebarTags.length === 0) return;
    setPendingBulkDeleteTags([...selectedSidebarTags]);
  };

  const deleteBulkSidebarTags = (tagsToDelete: string[]) => {
    const tagSet = new Set(tagsToDelete);
    tagsToDelete.forEach((tag) => deleteTag(tag));
    setTagOrder((prev) => prev.filter((tag) => !tagSet.has(tag)));
    setCleanupBypassTags((prev) => prev.filter((tag) => !tagSet.has(tag)));
    if (selectedTag && tagSet.has(selectedTag)) setSelectedTag(null);
    exitSidebarTagEditMode();
    setPendingBulkDeleteTags(null);
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

  const handleDeleteBookmarksOnTag = (tag: string, count: number) => {
    setPendingTagBookmarkDelete({ tag, count });
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

  const toggleAppPickerSelection = (app: AppShortcut) => {
    setAppPickerSelection((prev) =>
      prev.includes(app.id) ? prev.filter((id) => id !== app.id) : [...prev, app.id]
    );
  };

  const confirmAppPickerSelection = () => {
    const selectedApps = appCatalog.flatMap((group) => group.apps).filter((app) => appPickerSelection.includes(app.id));
    selectedApps.forEach((app) => addAppShortcut(app));
    setShowAppPicker(false);
    setAppPickerSelection([]);
    setAppSearch("");
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
      setAppPickerSelection([]);
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

  const openAddBookmarkModal = (tag?: string | null) => {
    const tags = tag ? [tag] : [];
    setModal({ mode: "add", prefill: tags.length ? { url: "", title: "", favicon: "", tags } : undefined });
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
    setPendingAppDelete(app);
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
            padding: "8px 0", minHeight: "100%",
          }}>
            <div style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              minHeight: 52,
              padding: "0 10px 6px 10px",
              marginBottom: 6,
              borderBottom: "1px solid var(--border)",
            }}>
              <img
                src="/icons/logo.png"
                alt="YahaBaby Bookmarks"
                width={172}
                height={48}
                style={{
                  display: "block",
                  flexShrink: 0,
                  background: "transparent",
                }}
              />
              <div style={{ marginTop: 4, fontSize: 11, fontWeight: 700, color: "var(--text-4)", letterSpacing: "0.08em" }}>
                VERSION {APP_VERSION}
              </div>
            </div>
            <div style={{ padding: "0 8px 8px 16px", display: "flex", alignItems: "center" }}>
                <span style={{ fontSize: 11, fontWeight: 700, color: "var(--text-4)", letterSpacing: "0.08em", textTransform: "uppercase", flex: 1 }}>
                  Apps
                </span>
              <SidebarNewButton
                onClick={() => { setShowAppPicker(true); setAppPickerError(null); setAppSearch(""); }}
                title="Add app shortcut"
              >
                + New
              </SidebarNewButton>
            </div>
            <div style={{ padding: "0 10px 10px 10px" }}>
              <div
                style={{ display: "flex", flexWrap: "wrap", justifyContent: "flex-start", gap: 8, padding: "0 0 17px 4px" }}
                onDragOver={(e) => {
                  const hasAppData = e.dataTransfer.types.includes(APP_SHORTCUT_DRAG_MIME);
                  const hasBookmarkData = e.dataTransfer.types.includes(BOOKMARK_DRAG_MIME) || e.dataTransfer.types.includes(BOOKMARK_SELECTION_DRAG_MIME);
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
                {visibleAppShortcuts.map((app) => {
                  return (
                    <div
                      key={app.id}
                      style={{ position: "relative", width: 24, height: 24 }}
                      onDragOver={(e) => {
                        const hasAppData = e.dataTransfer.types.includes(APP_SHORTCUT_DRAG_MIME);
                        const hasBookmarkData = e.dataTransfer.types.includes(BOOKMARK_DRAG_MIME) || e.dataTransfer.types.includes(BOOKMARK_SELECTION_DRAG_MIME);
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
                          cursor: appDraggingId === app.id ? "grabbing" : appDragReadyId === app.id ? "grab" : "default",
                          padding: 0,
                          opacity: appDraggingId === app.id ? 0.5 : 1,
                          transition: "opacity 0.12s ease, transform 0.12s ease",
                          transform: appDraggingId === app.id ? "scale(0.95)" : "none",
                        }}
                      >
                          <AppIcon app={app} width={24} height={24} radius={4} />
                        </button>
                      </div>
                    );
                  })}
              </div>
              <div style={{ margin: "0 6px 6px", height: 1, background: "var(--border)" }} />
            </div>
            {appShortcuts.length > 20 && (
              <div style={{ padding: "0 10px 8px 14px" }}>
                <button
                  onClick={() => setShowAllApps((v) => !v)}
                  style={{
                    width: "100%",
                    border: "none",
                    background: "none",
                    color: "var(--text-3)",
                    fontSize: 11,
                    fontWeight: 600,
                    cursor: "pointer",
                    padding: 0,
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                  }}
                >
                  <span style={{ flex: 1, height: 1, background: "var(--border)" }} />
                  <span style={{ whiteSpace: "nowrap" }}>{showAllApps ? "Show less" : "Show more"}</span>
                  <span style={{ flex: 1, height: 1, background: "var(--border)" }} />
                </button>
              </div>
            )}
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

            {pendingAppDelete && (
              <div
                onClick={() => setPendingAppDelete(null)}
                style={{
                  position: "fixed",
                  inset: 0,
                  background: "rgba(0,0,0,0.65)",
                  backdropFilter: "blur(4px)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  zIndex: 1000,
                }}
              >
                <div
                  onClick={(e) => e.stopPropagation()}
                  style={{
                    background: "var(--card)",
                    border: "1px solid #ef444440",
                    borderRadius: 14,
                    padding: 24,
                    width: 340,
                    display: "flex",
                    flexDirection: "column",
                    gap: 14,
                    boxShadow: "0 24px 60px rgba(0,0,0,0.6)",
                  }}
                >
                  <h2 style={{ fontSize: 16, fontWeight: 700, color: "#ef4444", margin: 0 }}>
                    Remove {pendingAppDelete.name} from Apps?
                  </h2>
                  <p style={{ fontSize: 13, color: "var(--text-2)", lineHeight: 1.6, margin: 0 }}>
                    This will remove <strong style={{ color: "var(--text)" }}>{pendingAppDelete.name}</strong> from the Apps sidebar.
                  </p>
                  <div style={{ display: "flex", gap: 8 }}>
                    <button
                      onClick={() => setPendingAppDelete(null)}
                      style={{
                        flex: 1,
                        background: "var(--border)",
                        border: "1px solid var(--border-hover)",
                        borderRadius: 8,
                        padding: "9px 0",
                        color: "var(--text-2)",
                        fontSize: 13,
                        fontWeight: 600,
                        cursor: "pointer",
                      }}
                    >
                      Cancel
                    </button>
                    <button
                      onClick={() => {
                        setAppShortcuts((prev) => prev.filter((x) => x.id !== pendingAppDelete.id));
                        setPendingAppDelete(null);
                      }}
                      style={{
                        flex: 1,
                        background: "#ef4444",
                        border: "none",
                        borderRadius: 8,
                        padding: "9px 0",
                        color: "#fff",
                        fontSize: 13,
                        fontWeight: 700,
                        cursor: "pointer",
                      }}
                    >
                      Remove App
                    </button>
                  </div>
                </div>
              </div>
            )}

            <div style={{ padding: "0 8px 10px 16px", display: "flex", alignItems: "center", gap: 6 }}>
              <span style={{ fontSize: 11, fontWeight: 700, color: "var(--text-4)", letterSpacing: "0.07em", textTransform: "uppercase", flex: 1 }}>
                {t("tags")}
              </span>
              <SidebarNewButton
                onClick={() => { setNewTagInput(""); setTimeout(() => newTagRef.current?.focus(), 50); }}
                title={t("createNewTag")}
              >
                {t("newShort")}
              </SidebarNewButton>
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
            <TagChip
              label={t("all")}
              count={bookmarks.filter((b) => !b.tags.includes(ARCHIVED_FILTER)).length}
              active={selectedTag === null}
              onClick={() => setSelectedTag(null)}
              vertical
            />
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
            <TagChip
              label="Archived"
              count={bookmarks.filter((b) => b.tags.includes(ARCHIVED_FILTER)).length}
              active={selectedTag === ARCHIVED_FILTER}
              onClick={() => setSelectedTag(selectedTag === ARCHIVED_FILTER ? null : ARCHIVED_FILTER)}
              vertical
            />
            <div style={{ margin: "8px 8px 8px 16px", display: "flex", alignItems: "center", gap: 6, width: "calc(100% - 24px)" }}>
              {sidebarTagEditMode && selectedSidebarTags.length > 0 ? (
                <>
                  <button
                    onClick={confirmBulkDeleteSidebarTags}
                    style={{
                      background: "#ef444420",
                      border: "1px solid #ef444440",
                      borderRadius: 5,
                      color: "#ef4444",
                      fontSize: 11,
                      fontWeight: 600,
                      cursor: "pointer",
                      padding: "2px 7px",
                      lineHeight: 1.4,
                    }}
                  >
                    Delete
                  </button>
                  <button
                    onClick={exitSidebarTagEditMode}
                    style={{
                      background: "none",
                      border: "1px solid var(--border-hover)",
                      borderRadius: 5,
                      color: "var(--text-3)",
                      fontSize: 11,
                      fontWeight: 600,
                      cursor: "pointer",
                      padding: "2px 7px",
                      lineHeight: 1.4,
                    }}
                  >
                    Cancel
                  </button>
                  <div style={{ flex: 1 }} />
                  <SidebarNewButton
                    onClick={toggleSidebarTagEditMode}
                    title="Edit tags"
                  >
                    Done
                  </SidebarNewButton>
                </>
              ) : (
                <>
                  <div style={{ flex: 1 }} />
                </>
              )}
            </div>
            <div style={{ height: 6 }} />
            {orderedSidebarTags.map((tag) => {
              const count = bookmarks.filter((b) => b.tags.includes(tag)).length;
              return (
                <SidebarTagRow
                  key={tag}
                  tag={tag}
                  count={count}
                  active={selectedTag === tag}
                  editMode={sidebarTagEditMode}
                  selected={selectedSidebarTags.includes(tag)}
                  theme={theme}
                  onSelect={() => setSelectedTag(selectedTag === tag ? null : tag)}
                  onToggleSelect={() => toggleSelectedSidebarTag(tag)}
                  onRename={(newName) => handleRenameSidebarTag(tag, newName)}
                  onDelete={() => setPendingTagDelete(tag)}
                  onDeleteBookmarks={() => handleDeleteBookmarksOnTag(tag, count)}
                  onMoveBookmarks={() => handleMoveBookmarksBetweenTags(tag, count)}
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
                  onBookmarkDrop={(bookmarkIds) => handleBookmarkDropOnTag(bookmarkIds, tag)}
                  onTagReorder={handleReorderSidebarTag}
                  activeContextMenu={sidebarTagContextMenu?.tag === tag ? sidebarTagContextMenu : null}
                  onOpenContextMenu={(x, y, openUp) => setSidebarTagContextMenu({ tag, x, y, openUp })}
                  onCloseContextMenu={() => setSidebarTagContextMenu(null)}
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
            height: 48,
            padding: "0 16px", borderBottom: "1px solid var(--border)",
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
            <div ref={themeMenuRef} style={{ position: "relative", flexShrink: 0 }}>
              <button
                onClick={() => setThemeMenuOpen((v) => !v)}
                title={t("themeSwitchTooltip", { theme })}
                aria-haspopup="menu"
                aria-expanded={themeMenuOpen}
                style={{
                  display: "flex", alignItems: "center", justifyContent: "center",
                  width: 28, height: 28, padding: 0, borderRadius: "9999px", border: "none",
                  background: "var(--card)",
                  cursor: "pointer", flexShrink: 0,
                }}
              >
                <span
                  data-theme={theme}
                  aria-hidden="true"
                  style={{
                    width: 18,
                    height: 18,
                    borderRadius: "9999px",
                    border: "1px solid var(--border)",
                    backgroundColor: "var(--bg)",
                    boxShadow: "0 1px 2px rgba(0, 0, 0, 0.18)",
                    display: "block",
                  }}
                />
              </button>

              {themeMenuOpen && (
                <div
                  role="menu"
                  aria-label="Theme picker"
                  style={{
                    position: "absolute",
                    top: "calc(100% + 8px)",
                    left: 0,
                    zIndex: 30,
                    width: 240,
                    maxHeight: 320,
                    overflow: "hidden",
                    borderRadius: 12,
                    border: "1px solid var(--border-hover)",
                    background: "var(--surface)",
                    boxShadow: "0 16px 40px rgba(0,0,0,0.35)",
                  }}
                >
                  <div style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    padding: "10px 12px",
                    borderBottom: "1px solid var(--border)",
                  }}>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontSize: 11, fontWeight: 700, color: "var(--text-4)", letterSpacing: "0.07em", textTransform: "uppercase" }}>
                        Theme
                      </div>
                      <div style={{ fontSize: 13, fontWeight: 700, color: "var(--text)" }}>
                        {themeLabel}
                      </div>
                    </div>
                    <button
                      onClick={() => setTheme((t) => nextTheme(t))}
                      style={{
                        border: "none",
                        borderRadius: 6,
                        padding: "5px 8px",
                        background: "var(--border)",
                        color: "var(--text-2)",
                        fontSize: 12,
                        fontWeight: 600,
                        cursor: "pointer",
                      }}
                    >
                      Next
                    </button>
                  </div>
                  <div style={{ height: 264, overflowY: "auto", overflowX: "hidden", padding: 8 }}>
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 24px)", gap: 6, justifyContent: "start" }}>
                      {THEME_CYCLE.map((candidate) => {
                        const active = candidate === theme;
                        return (
                          <button
                            key={candidate}
                            onClick={() => {
                              setTheme(candidate);
                              setThemeMenuOpen(false);
                            }}
                            aria-label={`Switch theme to ${formatThemeLabel(candidate)}`}
                            title={formatThemeLabel(candidate)}
                            aria-pressed={active}
                            data-theme={candidate}
                            style={{
                              position: "relative",
                              width: 24,
                              height: 24,
                              padding: 0,
                              borderRadius: "9999px",
                              border: "1px solid var(--border)",
                              backgroundColor: "var(--bg)",
                              boxShadow: active ? "0 0 0 2px #3b82f6" : "0 1px 2px rgba(0, 0, 0, 0.18)",
                              transform: active ? "scale(1.1)" : "scale(1)",
                              cursor: "pointer",
                              transition: "transform 150ms ease, box-shadow 150ms ease",
                            }}
                          >
                            {active && (
                              <span style={{
                                position: "absolute",
                                inset: 0,
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "center",
                                fontSize: 10,
                                fontWeight: 700,
                                color: "var(--text)",
                                pointerEvents: "none",
                              }}>
                                ✓
                              </span>
                            )}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                </div>
              )}
            </div>
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

            <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
              <button
                onClick={() => setShowTrialModal(true)}
                title={trialEnded ? "Trial ended" : `${trialLabel} - License`}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 6,
                  height: 28,
                  padding: "0 10px",
                  borderRadius: 9999,
                  border: `1px solid ${trialBadgeBorder}`,
                  backgroundColor: trialBadgeBackground,
                  backgroundImage: "none",
                  boxShadow: isDarkTheme ? "inset 0 0 0 1px rgba(255,255,255,0.28)" : "none",
                  color: trialBadgeTextColor,
                  cursor: "pointer",
                  flexShrink: 0,
                  whiteSpace: "nowrap",
                }}
              >
                <IconKey outlined={!isDarkTheme} />
                <span style={{ fontSize: 12, fontWeight: 700 }}>{trialLabel}</span>
              </button>
              <button
                onClick={() => setShowTrialModal(true)}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  height: 28,
                  padding: "0 10px",
                  borderRadius: 9999,
                  border: "none",
                  background: "#3b82f6",
                  color: "#fff",
                  cursor: "pointer",
                  flexShrink: 0,
                  whiteSpace: "nowrap",
                  fontSize: 12,
                  fontWeight: 700,
                }}
              >
                Upgrade Now
              </button>
            </div>

            <div style={{ flex: 1 }} />

            <div style={{ display: "flex", alignItems: "center", gap: 6, width: 260, flexShrink: 0 }}>
              <div style={{ position: "relative", flex: 1, minWidth: 0 }}>
                <input
                  type="text"
                  placeholder={t("searchPlaceholder")}
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  style={{
                    background: "var(--card)",
                    border: "1px solid var(--border-hover)",
                    borderRadius: 7,
                    padding: "6px 30px 6px 12px",
                    color: "var(--text)",
                    fontSize: 13,
                    outline: "none",
                    width: "100%",
                  }}
                />
                {search && (
                  <button
                    type="button"
                    onClick={() => setSearch("")}
                    aria-label="Clear search"
                    title="Clear search"
                    style={{
                      position: "absolute",
                      top: "50%",
                      right: 8,
                      transform: "translateY(-50%)",
                      width: 18,
                      height: 18,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      border: "none",
                      borderRadius: 9999,
                      background: "transparent",
                      color: "var(--text-3)",
                      cursor: "pointer",
                      padding: 0,
                    }}
                  >
                    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                      <path d="M2 2L10 10" />
                      <path d="M10 2L2 10" />
                    </svg>
                  </button>
                )}
              </div>
              {search.trim() && (
                <button
                  type="button"
                  onClick={() => {
                    setPendingSearchTagAssign(sorted.map((b) => b.id));
                    setSearchTagSearch("");
                  }}
                  aria-label="Tag search results"
                  title="Tag search results"
                  style={{
                    width: 28,
                    height: 28,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    border: "1px solid var(--border-hover)",
                    borderRadius: 9999,
                    background: "var(--bg)",
                    color: "var(--text-2)",
                    cursor: "pointer",
                    padding: 0,
                    flexShrink: 0,
                  }}
                >
                  <img
                    src="/tag.svg"
                    alt=""
                    aria-hidden="true"
                    width={14}
                    height={14}
                    style={{ display: "block" }}
                  />
                </button>
              )}
            </div>

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
              <option value="ranking">Manual Sort</option>
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
                    icon={
                      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
                        <path d="M22.4475 1.55249C21.9788 1.08374 21.2175 1.08374 20.7488 1.55249L13.5488 8.75249L12.9563 8.15999C12.3863 7.58999 11.5125 7.46999 10.8075 7.85999L9.58876 8.53499L15.4575 14.4037L16.1325 13.185C16.5225 12.4837 16.3988 11.6062 15.8325 11.0362L15.24 10.4437L22.44 3.24374C22.9088 2.77499 22.9088 2.01374 22.44 1.54499L22.4475 1.55249ZM8.23126 9.29249L1.81501 12.8587C1.43626 13.0687 1.20001 13.47 1.20001 13.905C1.20001 14.22 1.32751 14.5275 1.54876 14.7487L3.16876 16.3687C3.24751 16.4475 3.36751 16.4775 3.47626 16.44L5.43001 15.7875C5.66626 15.7087 5.88751 15.9337 5.80876 16.1662L5.15626 18.12C5.11876 18.2287 5.14876 18.345 5.22751 18.4275L9.25126 22.4512C9.47626 22.6762 9.78001 22.8 10.0988 22.8C10.5338 22.8 10.935 22.5637 11.145 22.185L14.7113 15.7687L8.23501 9.29249H8.23126Z" fill="#A4A7AE" />
                      </svg>
                    }
                    label={t("cleanUp")}
                    disabled={cleanupState.running}
                    onClick={() => { setShowDataMenu(false); handleCleanup(); }}
                  />
                  <div style={{ height: 1, background: "var(--border)", margin: "4px 0" }} />
                  <DataMenuItem
                    icon={
                      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
                        <path d="M7.20005 2.40002C5.8763 2.40002 4.80005 3.47627 4.80005 4.80002V13.8H11.6288L10.4663 12.6375C10.1138 12.285 10.1138 11.715 10.4663 11.3663C10.8188 11.0175 11.3888 11.0138 11.7375 11.3663L14.4375 14.0663C14.79 14.4188 14.79 14.9888 14.4375 15.3375L11.7375 18.0375C11.385 18.39 10.815 18.39 10.4663 18.0375C10.1175 17.685 10.1138 17.115 10.4663 16.7663L11.6288 15.6038H4.80005V19.2038C4.80005 20.5275 5.8763 21.6038 7.20005 21.6038H16.8C18.1238 21.6038 19.2 20.5275 19.2 19.2038V8.79752C19.2 8.16002 18.9488 7.54877 18.4988 7.09877L14.5013 3.10127C14.0513 2.65127 13.4438 2.40002 12.8063 2.40002H7.20005ZM17.0063 9.00002H13.5C13.0013 9.00002 12.6 8.59877 12.6 8.10002V4.59377L17.0063 9.00002Z" fill="#A4A7AE" />
                      </svg>
                    }
                    label={t("import")}
                    onClick={() => { setShowDataMenu(false); setShowImport(true); }}
                  />
                  <DataMenuItem
                    icon={
                      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
                        <path d="M20.4 5.99998H7.19995C7.19995 4.67623 8.2762 3.59998 9.59995 3.59998H20.4C21.7237 3.59998 22.8 4.67623 22.8 5.99998V13.2C22.8 14.5237 21.7237 15.6 20.4 15.6H18.6V13.2H20.4V5.99998ZM1.19995 10.8C1.19995 9.47623 2.2762 8.39998 3.59995 8.39998H14.4C15.7237 8.39998 16.8 9.47623 16.8 10.8V18C16.8 19.3237 15.7237 20.4 14.4 20.4H3.59995C2.2762 20.4 1.19995 19.3237 1.19995 18V10.8ZM3.59995 12.3C3.59995 12.7987 4.0012 13.2 4.49995 13.2H13.5C13.9987 13.2 14.4 12.7987 14.4 12.3C14.4 11.8012 13.9987 11.4 13.5 11.4H4.49995C4.0012 11.4 3.59995 11.8012 3.59995 12.3Z" fill="#A4A7AE" />
                      </svg>
                    }
                    label={t("export")}
                    onClick={() => { setShowDataMenu(false); setShowExport(true); }}
                  />
                  <div style={{ height: 1, background: "var(--border)", margin: "4px 0" }} />
                  <DataMenuItem
                    icon={
                      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
                        <path d="M5.99998 3.59998C4.67623 3.59998 3.59998 4.67623 3.59998 5.99998V18C3.59998 19.3237 4.67623 20.4 5.99998 20.4H18C19.3237 20.4 20.4 19.3237 20.4 18V8.89873C20.4 8.26123 20.1487 7.64998 19.6987 7.19998L16.8 4.30123C16.35 3.85123 15.7387 3.59998 15.1012 3.59998H5.99998ZM7.19998 7.19998C7.19998 6.53623 7.73623 5.99998 8.39998 5.99998H14.4C15.0637 5.99998 15.6 6.53623 15.6 7.19998V9.59998C15.6 10.2637 15.0637 10.8 14.4 10.8H8.39998C7.73623 10.8 7.19998 10.2637 7.19998 9.59998V7.19998ZM12 13.2C13.3237 13.2 14.4 14.2762 14.4 15.6C14.4 16.9237 13.3237 18 12 18C10.6762 18 9.59998 16.9237 9.59998 15.6C9.59998 14.2762 10.6762 13.2 12 13.2Z" fill="#A4A7AE" />
                      </svg>
                    }
                    label={t("backup")}
                    onClick={() => { setShowDataMenu(false); handleBackup(); }}
                  />
                  <DataMenuItem
                    icon={
                      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
                        <path d="M7.20005 2.40002C5.8763 2.40002 4.80005 3.47627 4.80005 4.80002V13.8H11.6288L10.4663 12.6375C10.1138 12.285 10.1138 11.715 10.4663 11.3663C10.8188 11.0175 11.3888 11.0138 11.7375 11.3663L14.4375 14.0663C14.79 14.4188 14.79 14.9888 14.4375 15.3375L11.7375 18.0375C11.385 18.39 10.815 18.39 10.4663 18.0375C10.1175 17.685 10.1138 17.115 10.4663 16.7663L11.6288 15.6038H4.80005V19.2038C4.80005 20.5275 5.8763 21.6038 7.20005 21.6038H16.8C18.1238 21.6038 19.2 20.5275 19.2 19.2038V8.79752C19.2 8.16002 18.9488 7.54877 18.4988 7.09877L14.5013 3.10127C14.0513 2.65127 13.4438 2.40002 12.8063 2.40002H7.20005ZM17.0063 9.00002H13.5C13.0013 9.00002 12.6 8.59877 12.6 8.10002V4.59377L17.0063 9.00002Z" fill="#A4A7AE" />
                      </svg>
                    }
                    label={t("restore")}
                    onClick={() => { setShowDataMenu(false); restoreFileRef.current?.click(); }}
                  />
                  <div style={{ height: 1, background: "var(--border)", margin: "4px 0" }} />
                  <DataMenuItem
                    icon={
                      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
                        <path d="M2.40002 7.20005C2.40002 5.8763 3.47627 4.80005 4.80002 4.80005H16.3013C16.9388 4.80005 17.55 5.0513 18 5.5013L23.6475 11.1525C23.8725 11.3775 24 11.6813 24 12C24 12.3188 23.8725 12.6225 23.6475 12.8475L18 18.4988C17.55 18.9488 16.9388 19.2 16.3013 19.2H4.80002C3.47627 19.2 2.40002 18.1238 2.40002 16.8V7.20005ZM13.3463 9.4538C12.9938 9.1013 12.4238 9.1013 12.075 9.4538L10.8038 10.725L9.53252 9.4538C9.18002 9.1013 8.61002 9.1013 8.26127 9.4538C7.91252 9.8063 7.90877 10.3763 8.26127 10.725L9.53252 11.9963L8.26127 13.2675C7.90877 13.62 7.90877 14.19 8.26127 14.5388C8.61377 14.8875 9.18377 14.8913 9.53252 14.5388L10.8038 13.2675L12.075 14.5388C12.4275 14.8913 12.9975 14.8913 13.3463 14.5388C13.695 14.1863 13.6988 13.6163 13.3463 13.2675L12.075 11.9963L13.3463 10.725C13.6988 10.3725 13.6988 9.80255 13.3463 9.4538Z" fill="#F04438" />
                      </svg>
                    }
                    label={t("clearAllTags")}
                    danger
                    onClick={() => { setShowDataMenu(false); setShowClearAllTags(true); }}
                  />
                  <DataMenuItem
                    icon={
                      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
                        <path d="M5.1262 2.6213L4.79995 3.60005H2.39995C1.7362 3.60005 1.19995 4.1363 1.19995 4.80005C1.19995 5.4638 1.7362 6.00005 2.39995 6.00005H15.6C16.2637 6.00005 16.8 5.4638 16.8 4.80005C16.8 4.1363 16.2637 3.60005 15.6 3.60005H13.2L12.8737 2.6213C12.7087 2.13005 12.2512 1.80005 11.7337 1.80005H6.2662C5.7487 1.80005 5.2912 2.13005 5.1262 2.6213ZM18 8.40005C18 9.0638 18.5362 9.60005 19.2 9.60005H22.7999C23.4637 9.60005 23.9999 9.0638 23.9999 8.40005C23.9999 7.7363 23.4637 7.20005 22.7999 7.20005H19.2C18.5362 7.20005 18 7.7363 18 8.40005ZM15.6 7.80005H2.39995V19.2C2.39995 20.5238 3.4762 21.6 4.79995 21.6H13.2C14.5237 21.6 15.6 20.5238 15.6 19.2V7.80005ZM7.79995 11.1V18.3C7.79995 18.7988 7.3987 19.2 6.89995 19.2C6.4012 19.2 5.99995 18.7988 5.99995 18.3V11.1C5.99995 10.6013 6.4012 10.2 6.89995 10.2C7.3987 10.2 7.79995 10.6013 7.79995 11.1ZM12 11.1V18.3C12 18.7988 11.5987 19.2 11.1 19.2C10.6012 19.2 10.2 18.7988 10.2 18.3V11.1C10.2 10.6013 10.6012 10.2 11.1 10.2C11.5987 10.2 12 10.6013 12 11.1ZM19.2 12C18.5362 12 18 12.5363 18 13.2C18 13.8638 18.5362 14.4 19.2 14.4H21.5999C22.2637 14.4 22.7999 13.8638 22.7999 13.2C22.7999 12.5363 22.2637 12 21.5999 12H19.2ZM18 18C18 18.6638 18.5362 19.2 19.2 19.2C19.8637 19.2 20.4 18.6638 20.4 18C20.4 17.3363 19.8637 16.8 19.2 16.8C18.5362 16.8 18 17.3363 18 18Z" fill="#F04438" />
                      </svg>
                    }
                    label={t("deleteAll")}
                    danger
                    onClick={() => { setShowDataMenu(false); setShowDeleteAll(true); }}
                  />
                </div>
              )}
            </div>

            <input ref={restoreFileRef} type="file" accept=".json" style={{ display: "none" }} onChange={handleRestoreFile} />

            <Divider />

            <button onClick={() => openAddBookmarkModal()} style={{
              display: "flex", alignItems: "center", gap: 5,
              padding: "6px 12px", background: "#3b82f6", border: "none",
              borderRadius: 7, color: "#fff", fontSize: 13, fontWeight: 600, cursor: "pointer",
            }}>
              <span style={{ fontSize: 15, lineHeight: 1 }}>+</span> {t("add")}
            </button>
          </header>


          {/* Content */}
          <main
            ref={mainContentRef}
            onMouseDown={handleBookmarkSelectionStart}
            style={{ flex: 1, overflowY: "auto", padding: effectiveGroupByDate ? "0 16px 16px 16px" : "16px 16px 16px 16px", position: "relative" }}
          >
            {sorted.length === 0 ? (
              <Empty onAdd={() => openAddBookmarkModal(effectiveSelectedTag)} />
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
                  onArchive={handleArchiveBookmark}
                  onDragStartBookmark={handleBookmarkDragStart}
                  onDropBookmarkOnBookmark={handleReorderBookmark}
                  showPreview={displayMode === "preview"}
                  groupByDate={effectiveGroupByDate}
                  deleteConfirmId={deleteConfirm}
                  selectedBookmarkIds={selectedBookmarkIds}
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
                        onArchive={() => handleArchiveBookmark(b.id)}
                        onDragStartBookmark={handleBookmarkDragStart}
                        onDropBookmarkOnBookmark={handleReorderBookmark}
                        showPreview={displayMode === "preview"}
                        deleteConfirming={deleteConfirm === b.id}
                        archived={b.tags.includes(ARCHIVED_FILTER)}
                        selected={selectedBookmarkIds.includes(b.id)}
                      />
                    ))}
                </div>
              )
            )}
            {bookmarkSelectionDrag && (
              <div
                style={{
                  position: "fixed",
                  left: Math.min(bookmarkSelectionDrag.startX, bookmarkSelectionDrag.currentX),
                  top: Math.min(bookmarkSelectionDrag.startY, bookmarkSelectionDrag.currentY),
                  width: Math.abs(bookmarkSelectionDrag.currentX - bookmarkSelectionDrag.startX),
                  height: Math.abs(bookmarkSelectionDrag.currentY - bookmarkSelectionDrag.startY),
                  border: "1px solid rgba(59,130,246,0.9)",
                  background: "rgba(59,130,246,0.15)",
                  pointerEvents: "none",
                  zIndex: 80,
                }}
              />
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

        {pendingDuplicate && (
          <div
            onClick={() => settleDuplicateOverwrite(false)}
            style={{
              position: "fixed",
              inset: 0,
              background: "rgba(0,0,0,0.65)",
              backdropFilter: "blur(4px)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              zIndex: 1100,
            }}
          >
            <div
              onClick={(e) => e.stopPropagation()}
              style={{
                background: "var(--card)",
                border: "1px solid var(--border-hover)",
                borderRadius: 14,
                padding: 24,
                width: 420,
                maxWidth: "calc(100vw - 32px)",
                display: "flex",
                flexDirection: "column",
                gap: 14,
                boxShadow: "0 24px 60px rgba(0,0,0,0.6)",
              }}
            >
              <h2 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: "var(--text)", lineHeight: 1.3 }}>
                A bookmark for this link already exists.
              </h2>
              <div style={{ display: "flex", flexDirection: "column", gap: 6, fontSize: 13, color: "var(--text-2)", lineHeight: 1.6 }}>
                <div>Title: {pendingDuplicate.title || "Untitled"}</div>
                <div style={{ wordBreak: "break-all" }}>URL: {pendingDuplicate.url}</div>
              </div>
              <p style={{ margin: 0, fontSize: 13, color: "var(--text-2)", lineHeight: 1.6 }}>
                Confirm = overwrite existing bookmark
                <br />
                Cancel = keep existing bookmark
              </p>
              <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
                <button
                  onClick={() => settleDuplicateOverwrite(false)}
                  style={{
                    height: 34,
                    padding: "0 14px",
                    borderRadius: 8,
                    border: "1px solid var(--border-hover)",
                    background: "var(--card)",
                    color: "var(--text-2)",
                    cursor: "pointer",
                    fontSize: 13,
                    fontWeight: 600,
                  }}
                >
                  Cancel
                </button>
                <button
                  onClick={() => settleDuplicateOverwrite(true)}
                  style={{
                    height: 34,
                    padding: "0 14px",
                    borderRadius: 8,
                    border: "1px solid #ef4444",
                    background: "#ef4444",
                    color: "#fff",
                    cursor: "pointer",
                    fontSize: 13,
                    fontWeight: 700,
                  }}
                >
                  Overwrite bookmark
                </button>
              </div>
            </div>
          </div>
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
              setAppSearch("");
              setAppPickerSelection([]);
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
                maxHeight: "calc(100vh - 72px)", overflow: "hidden",
                display: "flex", flexDirection: "column", gap: 14,
                boxShadow: "0 24px 60px rgba(0,0,0,0.6)",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", position: "sticky", top: 0, zIndex: 2, background: "var(--card)" }}>
                <h2 style={{ fontSize: 16, fontWeight: 700, color: "var(--text)", margin: 0 }}>Add App Shortcut</h2>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <button
                    onClick={confirmAppPickerSelection}
                    disabled={appPickerSelection.length === 0}
                    style={{
                      height: 28, padding: "0 12px", borderRadius: 7, border: "1px solid #3b82f6",
                      background: "#3b82f6", color: "#fff", cursor: appPickerSelection.length === 0 ? "not-allowed" : "pointer",
                      fontSize: 13, fontWeight: 700, opacity: appPickerSelection.length === 0 ? 0.6 : 1,
                    }}
                  >
                    Done
                  </button>
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
              </div>

              <div style={{ flex: 1, overflowY: "auto", paddingRight: 2, display: "flex", flexDirection: "column", gap: 14 }}>
                <input
                  type="text"
                  value={appSearch}
                  onChange={(e) => setAppSearch(e.target.value)}
                  placeholder="Search apps"
                  style={{
                    height: 34,
                    width: "100%",
                    background: "var(--bg)",
                    border: "1px solid var(--border-hover)",
                    borderRadius: 8,
                    padding: "8px 12px",
                    color: "var(--text)",
                    fontSize: 13,
                    outline: "none",
                  }}
                />

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

                {filteredAppCatalog.map((group) => (
                  <div key={group.group} style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    <span style={{ fontSize: 12, color: "var(--text-3)", fontWeight: 700, letterSpacing: "0.05em", textTransform: "uppercase" }}>
                      {group.group}
                    </span>
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))", gap: 8 }}>
                      {group.apps.map((app) => {
                        const alreadyAdded = appShortcuts.some((x) => x.id === app.id || normaliseUrlForDedupe(x.url) === normaliseUrlForDedupe(app.url));
                        const selected = appPickerSelection.includes(app.id);
                        return (
                          <button
                            key={app.id}
                            onClick={() => {
                              if (alreadyAdded) return;
                              toggleAppPickerSelection(app);
                            }}
                            disabled={alreadyAdded}
                            style={{
                              display: "flex", alignItems: "center", gap: 8, height: 34,
                              padding: "0 10px", borderRadius: 8,
                              border: `1px solid ${alreadyAdded ? "var(--border)" : selected ? "#3b82f6" : "var(--border-hover)"}`,
                              background: alreadyAdded ? "var(--border)" : selected ? "#3b82f620" : "var(--card)",
                              color: alreadyAdded ? "var(--text-4)" : "var(--text-2)",
                              cursor: alreadyAdded ? "not-allowed" : "pointer",
                              fontSize: 12, fontWeight: 600, textAlign: "left",
                            }}
                          >
                            <AppIcon app={app} width={16} height={15} radius={3} />
                            <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1 }}>{app.name}</span>
                            {selected && !alreadyAdded && <span style={{ color: "#3b82f6", fontSize: 12, flexShrink: 0 }}>✓</span>}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
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

        {pendingMoveBookmarks && (
          <div
            onClick={() => {
              setPendingMoveBookmarks(null);
              setMoveBookmarksSearch("");
              setMoveBookmarksNewTag("");
            }}
            style={{
              position: "fixed",
              inset: 0,
              background: "rgba(0,0,0,0.65)",
              backdropFilter: "blur(4px)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              zIndex: 1000,
            }}
          >
            <div
              onClick={(e) => e.stopPropagation()}
              style={{
                background: "var(--card)",
                border: "1px solid var(--border-hover)",
                borderRadius: 14,
                padding: 24,
                width: 420,
                maxWidth: "calc(100vw - 32px)",
                display: "flex",
                flexDirection: "column",
                gap: 14,
                boxShadow: "0 24px 60px rgba(0,0,0,0.6)",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
                <h2 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: "var(--text)", lineHeight: 1.3 }}>
                  Move bookmarks from "{pendingMoveBookmarks}"
                </h2>
                <button
                  onClick={() => {
                    setPendingMoveBookmarks(null);
                    setMoveBookmarksSearch("");
                    setMoveBookmarksNewTag("");
                  }}
                  style={{
                    background: "none",
                    border: "none",
                    color: "var(--text-3)",
                    fontSize: 18,
                    cursor: "pointer",
                    lineHeight: 1,
                    padding: 2,
                    flexShrink: 0,
                  }}
                >
                  ✕
                </button>
              </div>
              <p style={{ margin: 0, fontSize: 13, color: "var(--text-2)", lineHeight: 1.5 }}>
                Choose an existing tag or create a new one for the selected bookmarks.
              </p>

              <input
                type="text"
                value={moveBookmarksSearch}
                onChange={(e) => setMoveBookmarksSearch(e.target.value)}
                placeholder="Search tags"
                style={{
                  width: "100%",
                  background: "var(--bg)",
                  border: "1px solid var(--border-hover)",
                  borderRadius: 8,
                  padding: "8px 12px",
                  color: "var(--text)",
                  fontSize: 13,
                  outline: "none",
                }}
              />

              <div
                style={{
                  display: "flex",
                  gap: 8,
                  alignItems: "center",
                }}
              >
                <input
                  type="text"
                  value={moveBookmarksNewTag}
                  onChange={(e) => setMoveBookmarksNewTag(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") createAndMoveBookmarksTarget();
                  }}
                  placeholder="Create new tag"
                  style={{
                    flex: 1,
                    background: "var(--bg)",
                    border: "1px solid var(--border-hover)",
                    borderRadius: 8,
                    padding: "8px 12px",
                    color: "var(--text)",
                    fontSize: 13,
                    outline: "none",
                  }}
                />
                <button
                  onClick={createAndMoveBookmarksTarget}
                  style={{
                    background: "#3b82f6",
                    border: "none",
                    borderRadius: 8,
                    padding: "8px 12px",
                    color: "#fff",
                    fontSize: 13,
                    fontWeight: 700,
                    cursor: "pointer",
                    whiteSpace: "nowrap",
                  }}
                >
                  Create & Move
                </button>
              </div>

              <div
                style={{
                  maxHeight: 260,
                  overflowY: "auto",
                  display: "flex",
                  flexWrap: "wrap",
                  gap: 8,
                  paddingRight: 2,
                }}
              >
                {allTags
                  .filter((tag) => tag !== pendingMoveBookmarks && tag.toLowerCase().includes(moveBookmarksSearch.trim().toLowerCase()))
                  .map((tag) => (
                    <button
                      key={tag}
                      onClick={() => confirmMoveBookmarksTarget(tag)}
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        width: "auto",
                        background: "var(--bg)",
                        border: "1px solid var(--border-hover)",
                        borderRadius: 9999,
                        padding: "7px 12px",
                        color: "var(--text)",
                        fontSize: 13,
                        cursor: "pointer",
                        flexShrink: 0,
                      }}
                    >
                      <span style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
                        <span
                          style={{
                            width: 8,
                            height: 8,
                            borderRadius: "50%",
                            background: tagColor(tag),
                            flexShrink: 0,
                          }}
                        />
                        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{tag}</span>
                      </span>
                    </button>
                  ))}
                {allTags.filter((tag) => tag !== pendingMoveBookmarks && tag.toLowerCase().includes(moveBookmarksSearch.trim().toLowerCase())).length === 0 && (
                  <div style={{ fontSize: 13, color: "var(--text-3)", padding: "8px 4px" }}>
                    No tags match your search.
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {showTrialModal && (
          <div
            onClick={() => setShowTrialModal(false)}
            style={{
              position: "fixed",
              inset: 0,
              background: "rgba(0,0,0,0.65)",
              backdropFilter: "blur(4px)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              zIndex: 4000,
            }}
          >
            <div
              onClick={(e) => e.stopPropagation()}
              style={{
                width: 380,
                background: "var(--card)",
                border: "1px solid var(--border-hover)",
                borderRadius: 16,
                padding: 20,
                boxShadow: "0 24px 60px rgba(0,0,0,0.6)",
                display: "flex",
                flexDirection: "column",
                gap: 16,
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <div style={{ width: 34, height: 34, borderRadius: 9999, background: trialModalIconBackground, display: "flex", alignItems: "center", justifyContent: "center", color: trialModalIconColor, flexShrink: 0 }}>
                  <IconKey outlined={!isDarkTheme} />
                </div>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 16, fontWeight: 800, color: "var(--text)", lineHeight: 1.2 }}>
                    {trialLabel}
                  </div>
                  <div style={{ fontSize: 12, color: "var(--text-3)", marginTop: 2 }}>
                    {trialEnded
                      ? "Your trial has ended. View and export still work, but editing is locked."
                      : `You have ${trialDaysLeft} day${trialDaysLeft === 1 ? "" : "s"} left to edit your links.`}
                  </div>
                </div>
              </div>
              <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
                <button
                  onClick={() => setShowTrialModal(false)}
                  style={{
                    background: "var(--border)",
                    border: "1px solid var(--border-hover)",
                    borderRadius: 8,
                    padding: "8px 12px",
                    color: "var(--text-2)",
                    fontSize: 13,
                    fontWeight: 700,
                    cursor: "pointer",
                  }}
                >
                  Close
                </button>
                <button
                  onClick={() => setShowTrialModal(false)}
                  style={{
                    background: "#3b82f6",
                    border: "none",
                    borderRadius: 8,
                    padding: "8px 12px",
                    color: "#fff",
                    fontSize: 13,
                    fontWeight: 700,
                    cursor: "pointer",
                  }}
                >
                  Upgrade Now
                </button>
              </div>
            </div>
          </div>
        )}

        {pendingSearchTagAssign && (
          <div
            onClick={() => {
              setPendingSearchTagAssign(null);
              setSearchTagSearch("");
            }}
            style={{
              position: "fixed",
              inset: 0,
              background: "rgba(0,0,0,0.65)",
              backdropFilter: "blur(4px)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              zIndex: 1100,
            }}
          >
            <div
              onClick={(e) => e.stopPropagation()}
              style={{
                background: "var(--card)",
                border: "1px solid var(--border-hover)",
                borderRadius: 14,
                padding: 24,
                width: 420,
                maxWidth: "calc(100vw - 32px)",
                display: "flex",
                flexDirection: "column",
                gap: 14,
                boxShadow: "0 24px 60px rgba(0,0,0,0.6)",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
                <h2 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: "var(--text)", lineHeight: 1.3 }}>
                  Tag search results
                </h2>
                <button
                  onClick={() => {
                    setPendingSearchTagAssign(null);
                    setSearchTagSearch("");
                  }}
                  style={{
                    background: "none",
                    border: "none",
                    color: "var(--text-3)",
                    fontSize: 18,
                    cursor: "pointer",
                    lineHeight: 1,
                    padding: 2,
                    flexShrink: 0,
                  }}
                >
                  ✕
                </button>
              </div>
              <p style={{ margin: 0, fontSize: 13, color: "var(--text-2)", lineHeight: 1.5 }}>
                Assign {pendingSearchTagAssign.length.toLocaleString()} search result{pendingSearchTagAssign.length === 1 ? "" : "s"} to a tag.
              </p>

              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <input
                  type="text"
                  value={searchTagSearch}
                  onChange={(e) => setSearchTagSearch(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") createAndApplySearchTag();
                  }}
                  placeholder="Search or add tag"
                  style={{
                    flex: 1,
                    background: "var(--bg)",
                    border: "1px solid var(--border-hover)",
                    borderRadius: 8,
                    padding: "8px 12px",
                    color: "var(--text)",
                    fontSize: 13,
                    outline: "none",
                  }}
                />

                <button
                  onClick={createAndApplySearchTag}
                  style={{
                    background: "#3b82f6",
                    border: "none",
                    borderRadius: 8,
                    padding: "8px 12px",
                    color: "#fff",
                    fontSize: 13,
                    fontWeight: 700,
                    cursor: "pointer",
                    whiteSpace: "nowrap",
                    flexShrink: 0,
                  }}
                >
                  + Add
                </button>
              </div>

              <div
                style={{
                  maxHeight: 260,
                  overflowY: "auto",
                  display: "flex",
                  flexWrap: "wrap",
                  gap: 8,
                  paddingRight: 2,
                }}
              >
                {allTags
                  .filter((tag) => tag.toLowerCase().includes(searchTagSearch.trim().toLowerCase()))
                  .map((tag) => (
                    <button
                      key={tag}
                      onClick={() => applySearchTagToBookmarks(tag)}
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        width: "auto",
                        background: "var(--bg)",
                        border: "1px solid var(--border-hover)",
                        borderRadius: 9999,
                        padding: "7px 12px",
                        color: "var(--text)",
                        fontSize: 13,
                        cursor: "pointer",
                        flexShrink: 0,
                      }}
                    >
                      <span style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
                        <span
                          style={{
                            width: 8,
                            height: 8,
                            borderRadius: "50%",
                            background: tagColor(tag),
                            flexShrink: 0,
                          }}
                        />
                        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{tag}</span>
                      </span>
                    </button>
                  ))}
                {allTags.filter((tag) => tag.toLowerCase().includes(searchTagSearch.trim().toLowerCase())).length === 0 && (
                  <div style={{ fontSize: 13, color: "var(--text-3)", padding: "8px 4px" }}>
                    No tags match your search.
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {pendingBulkDeleteTags && (
          <div
            onClick={() => setPendingBulkDeleteTags(null)}
            style={{
              position: "fixed", inset: 0, background: "rgba(0,0,0,0.65)",
              backdropFilter: "blur(4px)", display: "flex",
              alignItems: "center", justifyContent: "center", zIndex: 1200,
            }}
          >
            <div
              onClick={(e) => e.stopPropagation()}
              style={{
                background: "var(--card)", border: "1px solid #ef444440",
                borderRadius: 14, padding: 24, width: 360, maxWidth: "calc(100vw - 32px)",
                display: "flex", flexDirection: "column", gap: 14,
                boxShadow: "0 24px 60px rgba(0,0,0,0.6)",
              }}
            >
              <h2 style={{ fontSize: 16, fontWeight: 700, color: "#ef4444", margin: 0 }}>
                Delete {pendingBulkDeleteTags.length} tag{pendingBulkDeleteTags.length !== 1 ? "s" : ""}?
              </h2>
              <p style={{ fontSize: 13, color: "var(--text-2)", lineHeight: 1.6, margin: 0 }}>
                This will remove the selected tag{pendingBulkDeleteTags.length !== 1 ? "s" : ""} from the sidebar and from all bookmarks currently using them.
              </p>
              <div style={{ display: "flex", gap: 8 }}>
                <button
                  onClick={() => setPendingBulkDeleteTags(null)}
                  style={{
                    flex: 1, background: "var(--border)", border: "1px solid var(--border-hover)",
                    borderRadius: 8, padding: "9px 0", color: "var(--text-2)",
                    fontSize: 13, fontWeight: 600, cursor: "pointer",
                  }}
                >
                  Cancel
                </button>
                <button
                  onClick={() => deleteBulkSidebarTags(pendingBulkDeleteTags)}
                  style={{
                    flex: 1, background: "#ef4444", border: "none",
                    borderRadius: 8, padding: "9px 0", color: "#fff",
                    fontSize: 13, fontWeight: 700, cursor: "pointer",
                  }}
                >
                  Delete
                </button>
              </div>
            </div>
          </div>
        )}

        {pendingTagClear && (
          <div
            onClick={() => setPendingTagClear(null)}
            style={{
              position: "fixed",
              inset: 0,
              background: "rgba(0,0,0,0.65)",
              backdropFilter: "blur(4px)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              zIndex: 1150,
            }}
          >
            <div
              onClick={(e) => e.stopPropagation()}
              style={{
                background: "var(--card)",
                border: "1px solid #ef444440",
                borderRadius: 14,
                padding: 24,
                width: 420,
                maxWidth: "calc(100vw - 32px)",
                display: "flex",
                flexDirection: "column",
                gap: 14,
                boxShadow: "0 24px 60px rgba(0,0,0,0.6)",
              }}
            >
              <h2 style={{ fontSize: 16, fontWeight: 700, color: "#ef4444", margin: 0 }}>
                Clear tag "{pendingTagClear}"?
              </h2>
              <p style={{ fontSize: 13, color: "var(--text-2)", lineHeight: 1.6, margin: 0 }}>
                This tag has multiple bookmarks. Are you sure you want to clear it?
              </p>
              <div style={{ display: "flex", gap: 8 }}>
                <button
                  onClick={() => setPendingTagClear(null)}
                  style={{
                    flex: 1,
                    background: "var(--border)",
                    border: "1px solid var(--border-hover)",
                    borderRadius: 8,
                    padding: "9px 0",
                    color: "var(--text-2)",
                    fontSize: 13,
                    fontWeight: 600,
                    cursor: "pointer",
                  }}
                >
                  Cancel
                </button>
                <button
                  onClick={() => {
                    clearTag(pendingTagClear);
                    if (selectedTag === pendingTagClear) setSelectedTag(null);
                    setPendingTagClear(null);
                  }}
                  style={{
                    flex: 1,
                    background: "#ef4444",
                    border: "none",
                    borderRadius: 8,
                    padding: "9px 0",
                    color: "#fff",
                    fontSize: 13,
                    fontWeight: 700,
                    cursor: "pointer",
                  }}
                >
                  Clear Tag
                </button>
              </div>
            </div>
          </div>
        )}

        {pendingTagBookmarkDelete && (
          <div
            onClick={() => setPendingTagBookmarkDelete(null)}
            style={{
              position: "fixed",
              inset: 0,
              background: "rgba(0,0,0,0.65)",
              backdropFilter: "blur(4px)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              zIndex: 1160,
            }}
          >
            <div
              onClick={(e) => e.stopPropagation()}
              style={{
                background: "var(--card)",
                border: "1px solid #ef444440",
                borderRadius: 14,
                padding: 24,
                width: 420,
                maxWidth: "calc(100vw - 32px)",
                display: "flex",
                flexDirection: "column",
                gap: 14,
                boxShadow: "0 24px 60px rgba(0,0,0,0.6)",
              }}
            >
              <h2 style={{ fontSize: 16, fontWeight: 700, color: "#ef4444", margin: 0 }}>
                Delete bookmarks on "{pendingTagBookmarkDelete.tag}"?
              </h2>
              <p style={{ fontSize: 13, color: "var(--text-2)", lineHeight: 1.6, margin: 0 }}>
                This tag has {pendingTagBookmarkDelete.count} bookmark{pendingTagBookmarkDelete.count !== 1 ? "s" : ""}. Are you sure you want to delete them?
              </p>
              <div style={{ display: "flex", gap: 8 }}>
                <button
                  onClick={() => setPendingTagBookmarkDelete(null)}
                  style={{
                    flex: 1,
                    background: "var(--border)",
                    border: "1px solid var(--border-hover)",
                    borderRadius: 8,
                    padding: "9px 0",
                    color: "var(--text-2)",
                    fontSize: 13,
                    fontWeight: 600,
                    cursor: "pointer",
                  }}
                >
                  Cancel
                </button>
                <button
                  onClick={() => {
                    replaceBookmarks(bookmarks.filter((b) => !b.tags.includes(pendingTagBookmarkDelete.tag)));
                    if (selectedTag === pendingTagBookmarkDelete.tag) setSelectedTag(null);
                    setPendingTagBookmarkDelete(null);
                  }}
                  style={{
                    flex: 1,
                    background: "#ef4444",
                    border: "none",
                    borderRadius: 8,
                    padding: "9px 0",
                    color: "#fff",
                    fontSize: 13,
                    fontWeight: 700,
                    cursor: "pointer",
                  }}
                >
                  Delete bookmarks
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
  const [hovered, setHovered] = useState(false);
  const sourceKey = `${app.url}|${app.icon ?? ""}|${app.iconUrl ?? ""}`;

  useEffect(() => {
    queueMicrotask(() => setIdx(0));
  }, [sourceKey]);

  const src = sources[Math.min(idx, Math.max(0, sources.length - 1))] || faviconFromUrl(app.url);

  return (
    <span
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
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
        cursor: "pointer",
        transform: hovered ? "scale(1.06)" : "scale(1)",
        transition: "transform 180ms cubic-bezier(0.22, 1, 0.36, 1)",
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
          transform: hovered ? "scale(1.06)" : "scale(1)",
          transition: "transform 180ms cubic-bezier(0.22, 1, 0.36, 1)",
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
      <img src="/no-bookmarks-found.png" alt="" width={100} height={100} style={{ width: 100, height: 100, display: "block", margin: "0 auto 16px" }} />
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

function SidebarTagRow({ tag, count, active, editMode, selected, theme, onSelect, onToggleSelect, onRename, onDelete, onDeleteBookmarks, onMoveBookmarks, cleanupBypassed, onToggleCleanupBypass, onChangeColor, onBookmarkDrop, onTagReorder, activeContextMenu, onOpenContextMenu, onCloseContextMenu }: {
  tag: string; count: number; active: boolean; editMode: boolean; selected: boolean;
  theme: ThemeId;
  onSelect: () => void;
  onToggleSelect: () => void;
  onRename: (newName: string) => void;
  onDelete: () => void;
  onDeleteBookmarks: () => void;
  onMoveBookmarks: () => void;
  cleanupBypassed: boolean;
  onToggleCleanupBypass: () => void;
  onChangeColor: () => void;
  onBookmarkDrop: (bookmarkIds: string[]) => void;
  onTagReorder: (draggedTag: string, targetTag: string) => void;
  activeContextMenu: { tag: string; x: number; y: number; openUp: boolean } | null;
  onOpenContextMenu: (x: number, y: number, openUp: boolean) => void;
  onCloseContextMenu: () => void;
}) {
  const [hovered, setHovered] = useState(false);
  const [editing, setEditing] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const contextMenuRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const skipSave = useRef(false);
  const c = tagColor(tag);
  const isDarkTheme = theme === "dark" || theme === "midnight" || theme === "black" || theme === "graphite" || theme === "high-contrast" || theme.includes("night");

  useEffect(() => {
    if (!activeContextMenu) return;
    const closeOnOutsideClick = (e: MouseEvent) => {
      if (!contextMenuRef.current) return;
      if (!contextMenuRef.current.contains(e.target as Node)) {
        onCloseContextMenu();
      }
    };
    const closeOnEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCloseContextMenu();
    };
    const closeOnResize = () => onCloseContextMenu();
    const closeOnScroll = () => onCloseContextMenu();
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
  }, [activeContextMenu, onCloseContextMenu]);

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
        const menuWidth = 138;
        const menuHeight = 184;
        const margin = 8;
        const openUp = e.clientY + menuHeight + margin > window.innerHeight;
        const x = Math.min(e.clientX, window.innerWidth - menuWidth - margin);
        const y = openUp
          ? Math.max(margin, e.clientY - menuHeight - margin)
          : Math.min(e.clientY, window.innerHeight - menuHeight - margin);
        onOpenContextMenu(x, y, openUp);
      }}
      draggable={!editing && !editMode}
      onDragStart={(e) => {
        e.dataTransfer.effectAllowed = "move";
        e.dataTransfer.setData(TAG_DRAG_MIME, tag);
      }}
      onDragOver={(e) => {
        const hasBookmarkData = e.dataTransfer.types.includes(BOOKMARK_DRAG_MIME) || e.dataTransfer.types.includes(BOOKMARK_SELECTION_DRAG_MIME);
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
        const selectionRaw = e.dataTransfer.getData(BOOKMARK_SELECTION_DRAG_MIME);
        if (selectionRaw) {
          try {
            const parsed = JSON.parse(selectionRaw) as unknown;
            if (Array.isArray(parsed)) {
              const ids = parsed.map((id) => String(id)).filter(Boolean);
              if (ids.length > 0) {
                onBookmarkDrop(ids);
                return;
              }
            }
          } catch {
            // Fallback to single bookmark payload.
          }
        }
        const plain = e.dataTransfer.getData("text/plain");
        const fallbackId = plain.startsWith(BOOKMARK_DRAG_FALLBACK_PREFIX)
          ? plain.slice(BOOKMARK_DRAG_FALLBACK_PREFIX.length)
          : "";
        const bookmarkId = directId || fallbackId;
        if (!bookmarkId) return;
        onBookmarkDrop([bookmarkId]);
      }}
      style={{
        display: "flex", alignItems: "center",
        width: "calc(100% - 16px)", margin: "1px 8px", borderRadius: 6,
        background: dragOver ? c + "33" : editMode ? (selected ? c + "22" : hovered ? "var(--border)" : "transparent") : (active || hovered) ? c + "22" : "transparent",
        transition: "background 0.1s",
      }}
    >
      <button
        onClick={editMode ? onToggleSelect : onSelect}
        style={{
          flex: 1, display: "flex", alignItems: "center", gap: 8,
          padding: "6px 8px", background: "none", border: "none",
          color: active ? c : hovered ? "var(--text)" : "var(--text-2)",
          fontSize: 13, fontWeight: active ? 600 : 400,
          cursor: "pointer", textAlign: "left", overflow: "hidden",
          transition: "color 0.1s",
        }}
      >
        {editMode ? (
          <input
            type="checkbox"
            checked={selected}
            onChange={onToggleSelect}
            onClick={(e) => e.stopPropagation()}
            style={{
              width: 15,
              height: 15,
              cursor: "pointer",
              appearance: isDarkTheme ? "auto" : "none",
              ...(isDarkTheme ? {} : { WebkitAppearance: "none" as const }),
              backgroundColor: isDarkTheme ? "var(--card)" : "#ffffff",
              backgroundImage: isDarkTheme
                ? "none"
                : selected
                  ? "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 12 12' fill='none'%3E%3Cpath d='M2.3 6.4l2.1 2.1 5.3-5.3' stroke='%232563eb' stroke-width='1.9' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E\")"
                  : "none",
              backgroundRepeat: "no-repeat",
              backgroundPosition: "center",
              backgroundSize: "11px 11px",
              accentColor: isDarkTheme ? "#60a5fa" : "#2563eb",
              border: isDarkTheme ? "none" : "1px solid #cbd5e1",
              borderRadius: 4,
              flexShrink: 0,
              boxShadow: isDarkTheme
                ? "0 0 0 1px rgba(96, 165, 250, 0.6)"
                : "0 0 0 1px rgba(255, 255, 255, 0.9)",
              outline: isDarkTheme
                ? "1px solid rgba(15, 23, 42, 0.35)"
                : "1px solid rgba(37, 99, 235, 0.28)",
              outlineOffset: 1,
            }}
          />
        ) : (
          <span style={{ width: 8, height: 8, borderRadius: "50%", background: c, flexShrink: 0, display: "inline-block" }} />
        )}
        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1 }}>{tag}</span>
        <span style={{ fontSize: 11, color: "var(--text-4)", flexShrink: 0 }}>{count}</span>
      </button>

      {activeContextMenu && (
        <div
          ref={contextMenuRef}
          onClick={(e) => e.stopPropagation()}
          style={{
            position: "fixed",
            left: activeContextMenu.x,
            top: activeContextMenu.y,
            minWidth: 138,
            background: "var(--card)",
            border: "1px solid var(--border-hover)",
            borderRadius: 8,
            boxShadow: "0 10px 26px rgba(0,0,0,0.45)",
            padding: 4,
            zIndex: 3000,
          }}
        >
          <TagContextMenuItem
            onClick={() => {
              onChangeColor();
              onCloseContextMenu();
            }}
          >
            Change Color
          </TagContextMenuItem>
          <TagContextMenuItem
            onClick={() => {
              setEditing(true);
              onCloseContextMenu();
            }}
          >
            Rename Tag
          </TagContextMenuItem>
          <TagContextMenuItem
            onClick={() => {
              onToggleCleanupBypass();
              onCloseContextMenu();
            }}
            checked={cleanupBypassed}
            layout="space-between"
          >
            Bypass Clean Up
          </TagContextMenuItem>
          <TagContextMenuItem
            onClick={() => {
              onMoveBookmarks();
              onCloseContextMenu();
            }}
          >
            Move Bookmarks
          </TagContextMenuItem>
          <TagContextMenuItem
            onClick={() => {
              onDelete();
              onCloseContextMenu();
            }}
            danger
          >
            Delete Tag
          </TagContextMenuItem>
          <TagContextMenuItem
            onClick={() => {
              onDeleteBookmarks();
              onCloseContextMenu();
            }}
            danger
          >
            Delete Bookmarks
          </TagContextMenuItem>
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

function TagContextMenuItem({
  children,
  onClick,
  checked = false,
  danger = false,
  layout = "left",
}: {
  children: React.ReactNode;
  onClick: () => void;
  checked?: boolean;
  danger?: boolean;
  layout?: "left" | "space-between";
}) {
  const [hovered, setHovered] = useState(false);
  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        ...tagContextMenuBtn,
        display: "flex",
        alignItems: "center",
        justifyContent: layout,
        background: hovered ? (danger ? "rgba(239,68,68,0.12)" : "var(--border)") : "transparent",
        color: danger ? "#ef4444" : "var(--text-2)",
      }}
    >
      <span>{children}</span>
      {layout === "space-between" && (
        <span style={{ width: 16, textAlign: "right" }}>{checked ? "✓" : ""}</span>
      )}
    </button>
  );
}

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

function SidebarNewButton({
  children,
  onClick,
  title,
  style,
}: {
  children: React.ReactNode;
  onClick: () => void;
  title: string;
  style?: React.CSSProperties;
}) {
  const [hovered, setHovered] = useState(false);
  return (
    <button
      onClick={onClick}
      title={title}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        background: hovered ? "var(--sidebar-new-btn-hover-bg)" : "none",
        border: "1px solid var(--border-hover)",
        borderRadius: 5,
        color: "var(--text-3)",
        fontSize: 11,
        fontWeight: 600,
        cursor: "pointer",
        padding: "2px 7px",
        lineHeight: 1.4,
        transition: "background 0.12s",
        ...style,
      }}
    >
      {children}
    </button>
  );
}

function IconKey({ outlined = false }: { outlined?: boolean }) {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill={outlined ? "none" : "currentColor"} aria-hidden="true">
      <g transform="rotate(90 12 12)">
        <path
          d="m22 0h-1.436a2.978 2.978 0 0 0 -2.121.879l-8.527 8.521a7.518 7.518 0 1 0 4.684 4.684l2.4-2.4v-3.684h3v-3h3.551a2.978 2.978 0 0 0 .449-1.564v-1.436a2 2 0 0 0 -2-2zm-16.5 20a1.5 1.5 0 1 1 1.5-1.5 1.5 1.5 0 0 1 -1.5 1.5z"
          fill={outlined ? "none" : "currentColor"}
          stroke={outlined ? "currentColor" : "none"}
          strokeWidth={outlined ? 1.4 : 0}
          strokeLinejoin="round"
        />
      </g>
    </svg>
  );
}

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
