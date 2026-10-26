import assert from "node:assert/strict";
import { ClipdropService } from "../dist-api/clipdrop/clipdrop.service.js";

async function run() {
  console.log("=== Testing Knowledge-to-Poster Prompt Generation ===");
  const service = new ClipdropService();

  const mockKnowledge = {
    knowledgeConcept: "Microservices Event-Driven Architecture with Kafka: decoupling producers and consumers for ultra high throughput and zero data loss.",
    excerpt: "Event-driven architecture ensures that microservices communicate asynchronously via distributed event streams, reducing latency and preventing cascading system failures.",
    sourceVisualContext: "Extracted distributed cluster topology diagram and message queues from PDF (Page 4)",
    title: "Mastering Event-Driven Architecture",
    brand: {
      primary_color: "#704bd6",
      tone: "Authoritative & Innovative Tech",
      name: "CloudScale Systems",
    },
    platform: "Instagram",
  };

  const result = await service.suggestPosterPrompt(mockKnowledge);
  console.log("\nGenerated AI Poster Prompt:\n", result.prompt);
  console.log("\nGenerated Poster Headline:\n", result.headline);

  assert.ok(result.prompt && result.prompt.length > 20, "Prompt should be non-empty and descriptive");
  assert.ok(result.headline && result.headline.length > 3, "Headline should be non-empty");

  console.log("\n[SUCCESS] Knowledge Poster Prompt Generation verified successfully!");
}

run().catch(err => {
  console.error("Test failed:", err);
  process.exit(1);
});
