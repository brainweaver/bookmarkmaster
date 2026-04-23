import test from "node:test";
import assert from "node:assert/strict";
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
} from "../src/storage/preferences.ts";
import {
  CLEANUP_BYPASS_TAGS_KEY,
  PREF_DISPLAY_MODE_KEY,
  PREF_GROUP_BY_DATE_KEY,
  PREF_RANK_ORDER_KEY,
  PREF_SORT_BY_KEY,
  PREF_THEME_KEY,
  PREF_ZOOM_KEY,
  TAG_ORDER_KEY,
} from "../src/storage/keys.ts";
import { setPersistenceAdapter } from "../src/storage/persistence.ts";

class MapAdapter {
  constructor() {
    this.map = new Map();
  }
  getItem(key) {
    return this.map.get(key) ?? null;
  }
  setItem(key, value) {
    this.map.set(key, value);
  }
  removeItem(key) {
    this.map.delete(key);
  }
}

test("preference read/write helpers parse and validate by key", () => {
  const adapter = new MapAdapter();
  setPersistenceAdapter(adapter);

  writeThemePreference("ocean");
  writeDisplayModePreference("grid");
  writeGroupByDatePreference(true);
  writeSortByPreference("ranking");
  writeZoomPreference(4.25);
  writeRankOrderPreference(["a", "b"]);
  writeTagOrderPreference(["tag-a", "tag-b"]);
  writeCleanupBypassTagsPreference(["My Tag", "finance"]);

  assert.equal(readThemePreference(["ocean", "white"], "white"), "ocean");
  assert.equal(readDisplayModePreference("list"), "grid");
  assert.equal(readGroupByDatePreference(false), true);
  assert.equal(readSortByPreference("date"), "ranking");
  assert.equal(readZoomPreference(3, 1, 5), 4.25);
  assert.deepEqual(readRankOrderPreference(), ["a", "b"]);
  assert.deepEqual(readTagOrderPreference(), ["tag-a", "tag-b"]);
  assert.deepEqual(readCleanupBypassTagsPreference(), ["my-tag", "finance"]);

  // Migration-ish tolerant parsing checks
  adapter.setItem(PREF_GROUP_BY_DATE_KEY, "1");
  assert.equal(readGroupByDatePreference(false), true);
  adapter.setItem(PREF_GROUP_BY_DATE_KEY, "0");
  assert.equal(readGroupByDatePreference(true), false);
});

test("sanitizeBackupPreferences filters invalid values and normalizes tags", () => {
  const sanitized = sanitizeBackupPreferences(
    {
      theme: "ocean",
      displayMode: "grid",
      groupByDate: true,
      sortBy: "ranking",
      rankOrder: ["x", 1, "y"],
      zoom: 9,
      tagOrder: ["a", 2, "b"],
      cleanupBypassTags: ["My Tag", " ", "finance"],
      sidebarOpen: false,
      appShortcuts: [{ id: "a" }],
      appCatalog: [{ group: "x", apps: [] }],
      unknown: "value",
    },
    ["ocean", "white"]
  );

  assert.deepEqual(sanitized, {
    theme: "ocean",
    displayMode: "grid",
    groupByDate: true,
    sortBy: "ranking",
    rankOrder: ["x", "y"],
    zoom: 5,
    tagOrder: ["a", "b"],
    cleanupBypassTags: ["my-tag", "finance"],
    sidebarOpen: false,
    appShortcuts: [{ id: "a" }],
    appCatalog: [{ group: "x", apps: [] }],
  });
});

test("read helpers fallback safely on bad stored payloads", () => {
  const adapter = new MapAdapter();
  setPersistenceAdapter(adapter);

  adapter.setItem(PREF_THEME_KEY, "not-a-theme");
  adapter.setItem(PREF_DISPLAY_MODE_KEY, "broken");
  adapter.setItem(PREF_SORT_BY_KEY, "broken");
  adapter.setItem(PREF_ZOOM_KEY, "not-a-number");
  adapter.setItem(PREF_RANK_ORDER_KEY, "{\"bad\":true}");
  adapter.setItem(TAG_ORDER_KEY, "{\"bad\":true}");
  adapter.setItem(CLEANUP_BYPASS_TAGS_KEY, "{\"bad\":true}");

  assert.equal(readThemePreference(["ocean", "white"], "white"), "white");
  assert.equal(readDisplayModePreference("list"), "list");
  assert.equal(readSortByPreference("date"), "date");
  assert.equal(readZoomPreference(3, 1, 5), 3);
  assert.deepEqual(readRankOrderPreference(), []);
  assert.deepEqual(readTagOrderPreference(), []);
  assert.deepEqual(readCleanupBypassTagsPreference(), []);
});
