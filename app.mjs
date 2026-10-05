import { loadEnvFile } from "node:process";
import dns from "node:dns";

try {
  dns.setDefaultResultOrder("ipv4first");
} catch {}

try {
  loadEnvFile(".env");
} catch (error) {
  console.error("Could not load .env:", error);
}

const { bootstrap } = await import("./dist-api/phase-main.js");

bootstrap().catch((error) => {
  console.error("ContentOS startup failed:", error);
  process.exit(1);
});