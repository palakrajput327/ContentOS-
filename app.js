// Universal Passenger entry point (compatible with both CommonJS and ES Module loaders)
import("./app.mjs").catch((error) => {
  console.error("ContentOS startup failed:", error?.stack || error);
  process.exit(1);
});
