import { metaRequest } from "../dist-api/meta.api.js";
const id = process.env.FACEBOOK_APP_ID;
const secret = process.env.FACEBOOK_APP_SECRET;
if (!id || !secret) {
  console.log("Meta app credentials missing.");
  process.exitCode = 1;
} else
  try {
    const app = await metaRequest(id, id + "|" + secret, { fields: "id,name" });
    console.log(JSON.stringify({ credentialsValid: true, appName: app.name }));
  } catch (e) {
    console.log("Meta app credential validation failed: " + e.message);
    process.exitCode = 1;
  }
