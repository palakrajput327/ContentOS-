import { loadEnvFile } from "node:process";

try {
  loadEnvFile(".env");
} catch (error) {
  console.error("Could not load .env:", error);
}

import { bootstrap } from "./dist-api/phase-main.js";

bootstrap().catch((error) => {
  console.error("ContentOS startup failed:", error);
  process.exit(1);
});