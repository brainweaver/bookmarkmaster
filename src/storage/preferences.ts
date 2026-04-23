import {
  CLEANUP_BYPASS_TAGS_KEY,
  PREF_DISPLAY_MODE_KEY,
  PREF_GROUP_BY_DATE_KEY,
  PREF_RANK_ORDER_KEY,
  PREF_SORT_BY_KEY,
  PREF_THEME_KEY,
  PREF_ZOOM_KEY,
  TAG_ORDER_KEY,
} from "./keys.ts";
import { persistenceGetItem, persistenceSetItem } from "./persistence.ts";

export type DisplayModePreference = "grid" | "list" | "preview";
export type SortByPreference = "date" | "name" | "ranking";

type UnknownRecord = Record<string, unknown>;

export type SanitizedBackupPreferences = {
  theme?: string;
  displayMode?: DisplayModePreference;
  groupByDate?: boolean;
  sortBy?: SortByPreference;
  rankOrder?: string[];
  zoom?: number;
  tagOrder?: string[];
  cleanupBypassTags?: string[];
  sidebarOpen?: boolean;
  appShortcuts?: unknown[];
  appCatalog?: unknown[];
};

function normalizeTagName(raw: string): string {
  return raw.trim().toLowerCase().replace(/\s+/g, "-");
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((x): x is string => typeof x === "string");
}

function parseBoolean(raw: string | null, fallback: boolean): boolean {
  if (raw === null) return fallback;
  if (raw === "true" || raw === "1") return true;
  if (raw === "false" || raw === "0") return false;
  return fallback;
}

export function readThemePreference<TTheme extends string>(
  allowedThemes: readonly TTheme[],
  fallback: TTheme
): TTheme {
  const raw = persistenceGetItem(PREF_THEME_KEY);
  return raw && allowedThemes.includes(raw as TTheme) ? (raw as TTheme) : fallback;
}

export function readDisplayModePreference(
  fallback: DisplayModePreference = "list"
): DisplayModePreference {
  const raw = persistenceGetItem(PREF_DISPLAY_MODE_KEY);
  return raw === "grid" || raw === "list" || raw === "preview" ? raw : fallback;
}

export function readGroupByDatePreference(fallback = true): boolean {
  return parseBoolean(persistenceGetItem(PREF_GROUP_BY_DATE_KEY), fallback);
}

export function readSortByPreference(
  fallback: SortByPreference = "date"
): SortByPreference {
  const raw = persistenceGetItem(PREF_SORT_BY_KEY);
  return raw === "date" || raw === "name" || raw === "ranking" ? raw : fallback;
}

export function readZoomPreference(fallback = 3, min = 1, max = 5): number {
  const raw = persistenceGetItem(PREF_ZOOM_KEY);
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}

export function readRankOrderPreference(): string[] {
  try {
    const raw = persistenceGetItem(PREF_RANK_ORDER_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

export function readTagOrderPreference(): string[] {
  try {
    const raw = persistenceGetItem(TAG_ORDER_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

export function readCleanupBypassTagsPreference(): string[] {
  try {
    const raw = persistenceGetItem(CLEANUP_BYPASS_TAGS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((x): x is string => typeof x === "string")
      .map((x) => normalizeTagName(x))
      .filter(Boolean);
  } catch {
    return [];
  }
}

export function writeThemePreference(value: string): void {
  persistenceSetItem(PREF_THEME_KEY, value);
}

export function writeDisplayModePreference(value: DisplayModePreference): void {
  persistenceSetItem(PREF_DISPLAY_MODE_KEY, value);
}

export function writeGroupByDatePreference(value: boolean): void {
  persistenceSetItem(PREF_GROUP_BY_DATE_KEY, String(value));
}

export function writeSortByPreference(value: SortByPreference): void {
  persistenceSetItem(PREF_SORT_BY_KEY, value);
}

export function writeZoomPreference(value: number): void {
  persistenceSetItem(PREF_ZOOM_KEY, String(value));
}

export function writeRankOrderPreference(value: string[]): void {
  persistenceSetItem(PREF_RANK_ORDER_KEY, JSON.stringify(value));
}

export function writeTagOrderPreference(value: string[]): void {
  persistenceSetItem(TAG_ORDER_KEY, JSON.stringify(value));
}

export function writeCleanupBypassTagsPreference(value: string[]): void {
  persistenceSetItem(CLEANUP_BYPASS_TAGS_KEY, JSON.stringify(value));
}

export function sanitizeBackupPreferences(
  input: unknown,
  allowedThemes: readonly string[]
): SanitizedBackupPreferences {
  if (!input || typeof input !== "object") return {};
  const prefs = input as UnknownRecord;

  const themeRaw = typeof prefs.theme === "string" ? prefs.theme : undefined;
  const theme = themeRaw && allowedThemes.includes(themeRaw) ? themeRaw : undefined;

  const displayModeRaw = prefs.displayMode;
  const displayMode =
    displayModeRaw === "grid" || displayModeRaw === "list" || displayModeRaw === "preview"
      ? displayModeRaw
      : undefined;

  const sortByRaw = prefs.sortBy;
  const sortBy =
    sortByRaw === "date" || sortByRaw === "name" || sortByRaw === "ranking"
      ? sortByRaw
      : undefined;

  const zoomRaw = typeof prefs.zoom === "number" ? prefs.zoom : undefined;
  const zoom = zoomRaw !== undefined && Number.isFinite(zoomRaw)
    ? Math.max(1, Math.min(5, zoomRaw))
    : undefined;

  const cleanupBypassTags = asStringArray(prefs.cleanupBypassTags)
    .map((t) => normalizeTagName(t))
    .filter(Boolean);

  const rankOrder = asStringArray(prefs.rankOrder);
  const tagOrder = asStringArray(prefs.tagOrder);

  return {
    ...(theme ? { theme } : {}),
    ...(displayMode ? { displayMode } : {}),
    ...(typeof prefs.groupByDate === "boolean" ? { groupByDate: prefs.groupByDate } : {}),
    ...(sortBy ? { sortBy } : {}),
    ...(rankOrder.length > 0 ? { rankOrder } : {}),
    ...(zoom !== undefined ? { zoom } : {}),
    ...(tagOrder.length > 0 ? { tagOrder } : {}),
    ...(cleanupBypassTags.length > 0 ? { cleanupBypassTags } : {}),
    ...(typeof prefs.sidebarOpen === "boolean" ? { sidebarOpen: prefs.sidebarOpen } : {}),
    ...(Array.isArray(prefs.appShortcuts) ? { appShortcuts: prefs.appShortcuts } : {}),
    ...(Array.isArray(prefs.appCatalog) ? { appCatalog: prefs.appCatalog } : {}),
  };
}
