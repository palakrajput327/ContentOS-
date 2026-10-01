import assert from "node:assert/strict";
import { socialRedirectUri, socialCredentialConfigured } from "../dist-api/social.oauth.js";

const keys = ["APP_URL", "SOCIAL_OAUTH_BASE_URL", "LINKEDIN_REDIRECT_URI"];
const saved = keys.map(key => process.env[key]);
try {
  keys.forEach(key => delete process.env[key]);
  process.env.APP_URL = "http://localhost:5173/";
  assert.equal(socialRedirectUri("linkedin"), "http://localhost:5173/api/v1/social/accounts/linkedin/callback");
  process.env.LINKEDIN_REDIRECT_URI = "http://localhost:3001/api/v1/social/accounts/linkedin/callback";
  assert.equal(socialRedirectUri("linkedin"), process.env.LINKEDIN_REDIRECT_URI);
  process.env.LINKEDIN_REDIRECT_URI = "http://localhost:3001/api/v1/social/linkedin/callback";
  assert.throws(() => socialRedirectUri("linkedin"), /register that exact URL/);
  process.env.LINKEDIN_REDIRECT_URI = "javascript:alert(1)";
  assert.throws(() => socialRedirectUri("linkedin"));
  delete process.env.LINKEDIN_REDIRECT_URI;
  process.env.SOCIAL_OAUTH_BASE_URL = "https://api.example.com/";
  assert.equal(socialRedirectUri("youtube"), "https://api.example.com/api/v1/social/accounts/youtube/callback");
  assert.equal(socialCredentialConfigured(undefined), false);
  assert.equal(socialCredentialConfigured("your_linkedin_client_id"), false);
  assert.equal(socialCredentialConfigured("real-value"), true);
  console.log("Social OAuth callback and credential checks passed.");
} finally {
  keys.forEach((key, i) => saved[i] === undefined ? delete process.env[key] : process.env[key] = saved[i]);
}
