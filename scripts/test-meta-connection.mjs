import "reflect-metadata";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { SocialController } from "../dist-api/social.controller.js";
import { pool } from "../dist-api/db.js";
import { encryptToken, decryptToken } from "../dist-api/security.js";
import { META_SCOPES, metaPermissions } from "../dist-api/meta.api.js";
const original = {
  query: pool.query,
  connect: pool.connect,
  fetch: globalThis.fetch,
  key: process.env.TOKEN_ENCRYPTION_KEY,
  redirect: process.env.FACEBOOK_REDIRECT_URI,
  appUrl: process.env.APP_URL,
};
process.env.TOKEN_ENCRYPTION_KEY = "a".repeat(64);
const r = {
  workspace: { id: randomUUID(), role: "Owner" },
  user: { id: randomUUID() },
};
const id = randomUUID();
const controller = new SocialController();
let page = {
  id: "123",
  name: "Test Page",
  access_token: "page-test-token",
  tasks: ["CREATE_CONTENT"],
  instagram_business_account: { id: "456", username: "test-business" },
};
let pendingFound = true;
let claimed = true;
let writes = [];
const query = async (sql, params = []) => {
  if (sql.startsWith("SELECT * FROM meta_oauth_pending")) {
    assert.equal(params[1], r.workspace.id);
    assert.equal(params[2], r.user.id);
    return {
      rowCount: pendingFound ? 1 : 0,
      rows: pendingFound
        ? [{ ciphertext: encryptToken("user-test-token", r.workspace.id) }]
        : [],
    };
  }
  if (sql.startsWith("DELETE FROM meta_oauth_pending"))
    return { rowCount: claimed ? 1 : 0, rows: [] };
  if (sql.startsWith("INSERT INTO social_accounts")) {
    writes.push({ sql, params });
    return { rowCount: 1, rows: [{ id: randomUUID() }] };
  }
  if (sql.startsWith("INSERT INTO social_account_tokens"))
    writes.push({ sql, params });
  return { rowCount: 1, rows: [] };
};
try {
  process.env.FACEBOOK_REDIRECT_URI = 'https://hindustandigitalworkshop.info/api/v1/social/facebook/callback';
  process.env.APP_URL = 'http://localhost:5173';
  let redirected;
  await controller.oauthCallback('facebook', '', '', 'access_denied', {redirect(url) {redirected=url;}});
  assert.equal(new URL(redirected).origin, 'https://hindustandigitalworkshop.info');
  pool.query = query;
  pool.connect = async () => ({ query, release() {} });
  globalThis.fetch = async () => ({
    ok: true,
    json: async () => ({ data: [page] }),
  });
  const publicPages = await controller.listMetaPages(r, id);
  assert.ok(!JSON.stringify(publicPages).includes("token"));
  assert.deepEqual(await controller.selectMetaPage(r, id, { pageId: "123" }), {
    connected: true,
  });
  const accounts = writes.filter((w) =>
    w.sql.startsWith("INSERT INTO social_accounts"),
  );
  assert.deepEqual(
    accounts.map((w) => [w.params[2], w.params[3]]),
    [
      ["facebook", "123"],
      ["instagram", "456"],
    ],
  );
  const tokens = writes.filter((w) =>
    w.sql.startsWith("INSERT INTO social_account_tokens"),
  );
  assert.equal(tokens.length, 2);
  for (const saved of tokens) {
    assert.notEqual(saved.params[1], page.access_token);
    assert.equal(
      decryptToken(saved.params[1], r.workspace.id),
      page.access_token,
    );
    assert.throws(() => decryptToken(saved.params[1], randomUUID()));
  }
  writes = [];
  page = { ...page, instagram_business_account: undefined };
  await assert.rejects(
    controller.selectMetaPage(r, id, { pageId: "123" }),
    /No linked Instagram Business/,
  );
  assert.equal(writes.length, 0);
  page = { ...page, tasks: ["ANALYZE"] };
  await assert.rejects(
    controller.selectMetaPage(r, id, { pageId: "123" }),
    /no content publishing access/,
  );
  assert.equal(writes.length, 0);
  pendingFound = false;
  await assert.rejects(controller.listMetaPages(r, id), /selection expired/);
  pendingFound = true;
  claimed = false;
  page = {
    ...page,
    tasks: ["CREATE_CONTENT"],
    instagram_business_account: { id: "456" },
  };
  await assert.rejects(
    controller.selectMetaPage(r, id, { pageId: "123" }),
    /expired or already used/,
  );
  assert.equal(writes.length, 0);
  await assert.rejects(
    controller.listMetaPages(
      { ...r, workspace: { ...r.workspace, role: "Viewer" } },
      id,
    ),
    /role does not allow/,
  );
  globalThis.fetch = async () => ({
    ok: true,
    json: async () => ({
      data: META_SCOPES.split(",").map((permission) => ({
        permission,
        status: "granted",
      })),
    }),
  });
  await metaPermissions("test");
  globalThis.fetch = async () => ({
    ok: true,
    json: async () => ({
      data: [{ permission: "pages_show_list", status: "granted" }],
    }),
  });
  await assert.rejects(metaPermissions("test"), /pages_manage_posts/);
  console.log(
    "Meta Page selection, encrypted dual account storage, missing Instagram, publishing access, role checks, expired/replayed selection and declined permissions passed.",
  );
} finally {
  pool.query = original.query;
  pool.connect = original.connect;
  globalThis.fetch = original.fetch;
  if (original.key === undefined) delete process.env.TOKEN_ENCRYPTION_KEY;
  else process.env.TOKEN_ENCRYPTION_KEY = original.key;
  for (const [key,value] of [['FACEBOOK_REDIRECT_URI',original.redirect],['APP_URL',original.appUrl]]) {if(value===undefined)delete process.env[key];else process.env[key]=value;}
  await pool.end();
}
