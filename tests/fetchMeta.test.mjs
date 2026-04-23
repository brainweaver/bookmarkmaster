import test from "node:test";
import assert from "node:assert/strict";
import { resolveReachability } from "../src/utils/fetchMeta.ts";

test("resolveReachability keeps the full URL when it responds", async () => {
  const originalFetch = global.fetch;
  global.fetch = async (url) => {
    assert.equal(url, "https://example.com/page");
    return new Response("", { status: 200 });
  };

  try {
    await assert.doesNotReject(async () => {
      const result = await resolveReachability("https://example.com/page");
      assert.deepEqual(result, {
        reachable: true,
        resolvedUrl: "https://example.com/page",
      });
    });
  } finally {
    global.fetch = originalFetch;
  }
});

test("resolveReachability falls back to the main domain when the page fails", async () => {
  const originalFetch = global.fetch;
  const calls = [];
  global.fetch = async (url) => {
    calls.push(url);
    if (url === "https://example.com/page") {
      throw new Error("timeout");
    }
    if (url === "https://example.com/") {
      return new Response("", { status: 200 });
    }
    throw new Error(`unexpected url: ${url}`);
  };

  try {
    const result = await resolveReachability("https://example.com/page");
    assert.deepEqual(result, {
      reachable: true,
      resolvedUrl: "https://example.com/",
    });
    assert.deepEqual(calls, [
      "https://example.com/page",
      "https://example.com/",
    ]);
  } finally {
    global.fetch = originalFetch;
  }
});

test("resolveReachability does not fall back on HTTP error responses", async () => {
  const originalFetch = global.fetch;
  const calls = [];
  global.fetch = async (url) => {
    calls.push(url);
    return new Response("", { status: 404 });
  };

  try {
    const result = await resolveReachability("https://example.com/page");
    assert.deepEqual(result, {
      reachable: false,
      resolvedUrl: null,
    });
    assert.deepEqual(calls, ["https://example.com/page"]);
  } finally {
    global.fetch = originalFetch;
  }
});

test("resolveReachability marks the link unreachable when both attempts fail", async () => {
  const originalFetch = global.fetch;
  const calls = [];
  global.fetch = async (url) => {
    calls.push(url);
    if (url === "https://example.com/page" || url === "https://example.com/") {
      throw new Error("timeout");
    }
    throw new Error(`unexpected url: ${url}`);
  };

  try {
    const result = await resolveReachability("https://example.com/page");
    assert.deepEqual(result, {
      reachable: false,
      resolvedUrl: null,
    });
    assert.deepEqual(calls, [
      "https://example.com/page",
      "https://example.com/",
    ]);
  } finally {
    global.fetch = originalFetch;
  }
});
