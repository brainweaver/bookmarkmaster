export const TAG_COLORS: Record<string, string> = {
  dev: "#3b82f6",
  code: "#6366f1",
  design: "#ec4899",
  work: "#f59e0b",
  productivity: "#10b981",
  news: "#ef4444",
  reference: "#8b5cf6",
  hosting: "#06b6d4",
  css: "#38bdf8",
  media: "#f97316",
  entertainment: "#e879f9",
  inspiration: "#fb7185",
  ai: "#a78bfa",
  tools: "#34d399",
};

const TAG_FALLBACK_PALETTE = [
  "#22c55e",
  "#3b82f6",
  "#f59e0b",
  "#a855f7",
  "#ef4444",
  "#06b6d4",
  "#ec4899",
  "#84cc16",
  "#f97316",
  "#14b8a6",
];

const TAG_DYNAMIC_COLOR_MAP_KEY = "ui_tag_dynamic_colors_v1";
const TAG_LAST_ASSIGNED_COLOR_KEY = "ui_tag_last_assigned_color_v1";
const TAG_COLOR_OVERRIDE_MAP_KEY = "ui_tag_color_overrides_v1";

let dynamicTagColorMap: Record<string, string> | null = null;
let lastAssignedDynamicColor: string | null = null;
let tagColorOverrideMap: Record<string, string> | null = null;

function loadDynamicTagColorMap(): Record<string, string> {
  if (dynamicTagColorMap) return dynamicTagColorMap;
  try {
    const raw = localStorage.getItem(TAG_DYNAMIC_COLOR_MAP_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      dynamicTagColorMap = Object.fromEntries(
        Object.entries(parsed).filter(
          ([k, v]) => typeof k === "string" && typeof v === "string" && TAG_FALLBACK_PALETTE.includes(v)
        )
      ) as Record<string, string>;
    } else {
      dynamicTagColorMap = {};
    }
  } catch {
    dynamicTagColorMap = {};
  }

  try {
    const last = localStorage.getItem(TAG_LAST_ASSIGNED_COLOR_KEY);
    lastAssignedDynamicColor = last && TAG_FALLBACK_PALETTE.includes(last) ? last : null;
  } catch {
    lastAssignedDynamicColor = null;
  }

  return dynamicTagColorMap ?? {};
}

function saveDynamicTagColorMap(map: Record<string, string>, last: string) {
  try {
    localStorage.setItem(TAG_DYNAMIC_COLOR_MAP_KEY, JSON.stringify(map));
    localStorage.setItem(TAG_LAST_ASSIGNED_COLOR_KEY, last);
  } catch {
    // best-effort persistence only
  }
}

function randomFrom(colors: string[]): string {
  if (colors.length === 0) return TAG_FALLBACK_PALETTE[0];
  const idx = Math.floor(Math.random() * colors.length);
  return colors[idx];
}

function assignDynamicTagColor(tag: string): string {
  const key = tag.trim().toLowerCase();
  if (!key) return TAG_FALLBACK_PALETTE[0];

  const map = loadDynamicTagColorMap();
  const existing = map[key];
  if (existing) return existing;

  const used = new Set(Object.values(map));
  const unused = TAG_FALLBACK_PALETTE.filter((c) => !used.has(c));
  const avoidLast = (colors: string[]) =>
    lastAssignedDynamicColor ? colors.filter((c) => c !== lastAssignedDynamicColor) : colors;

  const pool =
    avoidLast(unused).length > 0
      ? avoidLast(unused)
      : avoidLast(TAG_FALLBACK_PALETTE).length > 0
      ? avoidLast(TAG_FALLBACK_PALETTE)
      : TAG_FALLBACK_PALETTE;

  const chosen = randomFrom(pool);
  map[key] = chosen;
  dynamicTagColorMap = map;
  lastAssignedDynamicColor = chosen;
  saveDynamicTagColorMap(map, chosen);
  return chosen;
}

function loadTagColorOverrideMap(): Record<string, string> {
  if (tagColorOverrideMap) return tagColorOverrideMap;
  try {
    const raw = localStorage.getItem(TAG_COLOR_OVERRIDE_MAP_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      tagColorOverrideMap = Object.fromEntries(
        Object.entries(parsed).filter(([k, v]) => typeof k === "string" && typeof v === "string")
      ) as Record<string, string>;
    } else {
      tagColorOverrideMap = {};
    }
  } catch {
    tagColorOverrideMap = {};
  }
  return tagColorOverrideMap ?? {};
}

function saveTagColorOverrideMap(map: Record<string, string>) {
  try {
    localStorage.setItem(TAG_COLOR_OVERRIDE_MAP_KEY, JSON.stringify(map));
  } catch {
    // best-effort persistence only
  }
}

export function tagColor(tag: string) {
  const key = tag.trim().toLowerCase();
  const overrides = loadTagColorOverrideMap();
  return overrides[key] ?? TAG_COLORS[key] ?? assignDynamicTagColor(key);
}

export function cycleTagColor(tag: string): string {
  const key = tag.trim().toLowerCase();
  if (!key) return TAG_FALLBACK_PALETTE[0];

  const current = tagColor(key);
  const idx = TAG_FALLBACK_PALETTE.indexOf(current);
  const next = TAG_FALLBACK_PALETTE[(idx + 1 + TAG_FALLBACK_PALETTE.length) % TAG_FALLBACK_PALETTE.length];

  const overrides = loadTagColorOverrideMap();
  overrides[key] = next;
  tagColorOverrideMap = overrides;
  saveTagColorOverrideMap(overrides);

  const dynamic = loadDynamicTagColorMap();
  if (dynamic[key]) {
    dynamic[key] = next;
    lastAssignedDynamicColor = next;
    saveDynamicTagColorMap(dynamic, next);
  }

  return next;
}

