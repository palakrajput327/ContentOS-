import process from "node:process";
import fs from "node:fs";
import dns from "node:dns";
import net from "node:net";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// 1. Safe .env loader that works across all Node.js versions (v18, v20, v22+)
function safeLoadEnv(envPath) {
  if (typeof process.loadEnvFile === "function") {
    try {
      process.loadEnvFile(envPath);
      return;
    } catch {
      // file might not exist or parser error, fallback to manual parse
    }
  }
  try {
    if (fs.existsSync(envPath)) {
      const content = fs.readFileSync(envPath, "utf8");
      for (const line of content.split(/\r?\n/)) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("#")) continue;
        const eqIdx = trimmed.indexOf("=");
        if (eqIdx > 0) {
          const key = trimmed.slice(0, eqIdx).trim();
          let val = trimmed.slice(eqIdx + 1).trim();
          if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
            val = val.slice(1, -1);
          }
          if (process.env[key] === undefined) {
            process.env[key] = val;
          }
        }
      }
    }
  } catch (err) {
    console.warn("[ContentOS] Could not load env file manually:", err?.message || err);
  }
}

safeLoadEnv(path.join(__dirname, ".env"));
safeLoadEnv(".env");

// 2. Resilient DNS fallback for Cloud Databases (Neon, AWS, etc.)
const originalLookup = dns.lookup;
const fallbackResolver = new dns.promises.Resolver();
try {
  fallbackResolver.setServers(["8.8.8.8", "1.1.1.1"]);
} catch {}

dns.lookup = function (hostname, options, callback) {
  if (typeof options === "function") {
    callback = options;
    options = {};
  }
  originalLookup(hostname, options, (err, address, family) => {
    if (err && (err.code === "ENOTFOUND" || err.code === "EREFUSED")) {
      fallbackResolver
        .resolve4(hostname)
        .then((addresses) => {
          if (addresses && addresses.length > 0) {
            if (options && options.all) {
              return callback(
                null,
                addresses.map((a) => ({ address: a, family: 4 })),
              );
            }
            return callback(null, addresses[0], 4);
          }
          callback(err, address, family);
        })
        .catch(() => {
          callback(err, address, family);
        });
    } else {
      callback(null, address, family);
    }
  });
};


// 2. Automatically ensure local Redis is running (Windows dev only)
async function ensureRedis() {
  return new Promise((resolve) => {
    const socket = net.connect({ host: "127.0.0.1", port: 6379 }, () => {
      socket.destroy();
      resolve();
    });
    socket.on("error", () => {
      socket.destroy();
      console.log("[ContentOS] Auto-starting local Redis services...");
      try {
        const proc = spawn("node", ["scripts/local-services.mjs"], {
          detached: true,
          stdio: "ignore",
          windowsHide: true,
        });
        proc.unref();
      } catch (err) {
        console.warn("[ContentOS] Could not spawn local-services:", err.message);
      }
      setTimeout(resolve, 1500);
    });
  });
}

if (process.platform === "win32" && (process.env.QUEUE_BACKEND || "bullmq") === "bullmq") {
  await ensureRedis();
}

// 3. Process-level safety nets to prevent cloud timeouts from crashing the server
process.on("unhandledRejection", (reason) => {
  console.warn("[ContentOS] Handled unhandled rejection (server online):", reason?.message || reason);
});

process.on("uncaughtException", (error) => {
  console.warn("[ContentOS] Handled uncaught exception (server online):", error?.message || error);
});

process.on("SIGINT", () => {
  console.log("[ContentOS] Shutting down cleanly...");
  process.exit(0);
});
process.on("SIGTERM", () => {
  console.log("[ContentOS] Shutting down cleanly...");
  process.exit(0);
});

if (!process.env.QUEUE_BACKEND) process.env.QUEUE_BACKEND = "postgres";

const { bootstrap } = await import("./dist-api/phase-main.js");

bootstrap().catch((error) => {
  console.error("ContentOS startup failed:", error?.stack || error);
  process.exit(1);
});