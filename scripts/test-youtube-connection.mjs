import assert from "node:assert/strict";
import { YouTubeProvider } from "../dist-api/social.provider.js";
const originalFetch = globalThis.fetch;
try {
  const provider = new YouTubeProvider();
  globalThis.fetch = async () => new Response(JSON.stringify({ items: [] }), { status: 200 });
  assert.equal((await provider.validateConnection({ token: "test-token" })).status, "DESTINATION_NOT_FOUND");
  globalThis.fetch = async () => new Response(JSON.stringify({ error: { message: "YouTube Data API v3 is disabled" } }), { status: 403 });
  const denied = await provider.validateConnection({ token: "test-token" });
  assert.equal(denied.status, "INSUFFICIENT_PERMISSION");
  assert.match(denied.details.error, /disabled/);
  globalThis.fetch = async (url, init) => {
    assert.equal(init.headers.Authorization, "Bearer test-token");
    return new Response(JSON.stringify({ items: [{ id: "channel-id", snippet: { title: "Test channel" } }] }), { status: 200 });
  };
  const connected = await provider.validateConnection({ token: "test-token" });
  assert.equal(connected.valid, true);
  assert.equal(connected.providerId, "channel-id");
  assert.equal(connected.name, "Test channel");
  assert.equal((await provider.publishText({}, { text: "Test", destination: "channel-id" })).success, false);
  console.log("YouTube channel validation and unsupported text publishing checks passed. No external requests sent.");
} finally { globalThis.fetch = originalFetch; }
