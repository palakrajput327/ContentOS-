import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  buildRichCaption,
  formatCaptionForPlatform,
  formatBrandName,
  extractContactInfoFromText,
  toHashtag,
} from "../dist-api/documents/caption-generator.js";

describe("ContentOS Visual Concepts & Caption Architecture Tests", () => {
  it("1. Converts topic string into clean PascalCase hashtag", () => {
    assert.equal(toHashtag("Fintech Liquidity"), "FintechLiquidity");
    assert.equal(toHashtag("due diligence & compliance!"), "DueDiligenceCompliance");
    assert.equal(toHashtag("TradeOrbit"), "Tradeorbit");
  });

  it("2. Formats clean brand name stripping noise words and file extensions", () => {
    assert.equal(formatBrandName("TradeOrbit_Final_15_Page_Business.pdf"), "TradeOrbit");
    assert.equal(formatBrandName("Regulus_Strategy_Deck.pdf"), "Regulus Strategy");
    // 'Overview' is filtered out as a document type qualifier
    assert.equal(formatBrandName("Company_Overview.pdf"), "Company");
  });

  it("3. Extracts website domain and email from raw document text", () => {
    const rawPages = [
      "Welcome to TradeOrbit official presentation. Visit https://www.tradeorbit.world for disclosures.",
      "For institutional inquiries contact support@tradeorbit.world or call +91 98765 43210.",
    ];
    const contact = extractContactInfoFromText(rawPages);
    assert.equal(contact.website, "www.tradeorbit.world");
    assert.equal(contact.email, "support@tradeorbit.world");
  });

  it("4. Generates unique, structured social caption for concept", () => {
    const caption = buildRichCaption({
      title: "Booster Income Accelerator Tiers",
      companyName: "TradeOrbit",
      excerpt: "Accelerators provide multi-tiered liquidity multiplication across verified staking vaults.",
      prompt: "Advanced financial performance dashboard displaying tiered accelerator metrics.",
      sourcePage: 5,
    });

    assert.ok(caption.includes("UNLOCK MULTIPLIED RETURNS!"), "Caption must feature topic headline punch");
    assert.ok(caption.includes("TradeOrbit"), "Caption must include company/document name");
    assert.ok(caption.includes("#Tradeorbit"), "Caption must include branded hashtag (#Tradeorbit)");
    assert.ok(caption.includes("Bronze Tier"), "Booster Accelerator topic must include milestone tiers");
  });

  it("5. Customizes caption format per social platform constraints", () => {
    const longCaption = buildRichCaption({
      title: "Booster Income Accelerator Tiers",
      companyName: "TradeOrbit",
      excerpt: "Accelerators provide multi-tiered liquidity multiplication across verified staking vaults.",
      prompt: "Advanced financial performance dashboard displaying tiered accelerator metrics.",
      sourcePage: 5,
    });

    // Telegram: maximum 1024 chars
    const telegram = formatCaptionForPlatform(longCaption, "Telegram");
    assert.ok(telegram.length <= 1024, "Telegram caption must not exceed 1024 characters");

    // X / Twitter: maximum 280 chars
    const twitter = formatCaptionForPlatform(longCaption, "X");
    assert.ok(twitter.length <= 280, "X (Twitter) caption must not exceed 280 character limit");

    // Instagram: maximum 2200 chars
    const instagram = formatCaptionForPlatform(longCaption, "Instagram");
    assert.ok(instagram.length <= 2200, "Instagram caption must not exceed 2200 characters");

    // LinkedIn: maximum 3000 chars
    const linkedIn = formatCaptionForPlatform(longCaption, "LinkedIn");
    assert.ok(linkedIn.length <= 3000, "LinkedIn caption must not exceed 3000 characters");
  });
});
