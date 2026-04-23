import test from "node:test";
import assert from "node:assert/strict";
import {
  persistenceGetItem,
  persistenceGetJson,
  persistenceRemoveItem,
  persistenceSetItem,
  persistenceSetJson,
  setPersistenceAdapter,
} from "../src/storage/persistence.ts";

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

test("persistence adapter set/get/remove round-trip", () => {
  const adapter = new MapAdapter();
  setPersistenceAdapter(adapter);

  persistenceSetItem("k1", "v1");
  assert.equal(persistenceGetItem("k1"), "v1");

  persistenceRemoveItem("k1");
  assert.equal(persistenceGetItem("k1"), null);
});

test("JSON helpers round-trip and fallback on malformed JSON", () => {
  const adapter = new MapAdapter();
  setPersistenceAdapter(adapter);

  persistenceSetJson("obj", { a: 1, b: "x" });
  assert.deepEqual(persistenceGetJson("obj", { a: 0, b: "" }), { a: 1, b: "x" });

  adapter.setItem("bad", "{not-valid-json");
  assert.deepEqual(persistenceGetJson("bad", { ok: true }), { ok: true });
});

test("adapter errors are swallowed safely", () => {
  setPersistenceAdapter({
    getItem() {
      throw new Error("boom");
    },
    setItem() {
      throw new Error("boom");
    },
    removeItem() {
      throw new Error("boom");
    },
  });

  assert.equal(persistenceGetItem("x"), null);
  assert.deepEqual(persistenceGetJson("x", { ok: true }), { ok: true });
  assert.doesNotThrow(() => persistenceSetItem("x", "1"));
  assert.doesNotThrow(() => persistenceRemoveItem("x"));
});
