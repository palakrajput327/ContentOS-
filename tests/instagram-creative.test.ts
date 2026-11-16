import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { pool } from "../dist-api/db.js";
import { BrandDnaService } from "../dist-api/creative/brand-dna.service.js";
import { CreativeVariationService } from "../dist-api/creative/creative-variation.service.js";
import { CarouselService } from "../dist-api/creative/carousel.service.js";

describe("ContentOS Instagram Creative Studio Integration Tests", () => {
  let testWorkspaceId: string;
  let testUserId: string;
  const brandService = new BrandDnaService();
  const variationService = new CreativeVariationService();
  const carouselService = new CarouselService();

  before(async () => {
    // 1. Fetch or create a test workspace and user
    const wsRes = await pool.query("SELECT id FROM workspaces LIMIT 1");
    if (wsRes.rowCount && wsRes.rowCount > 0) {
      testWorkspaceId = wsRes.rows[0].id;
    } else {
      testWorkspaceId = randomUUID();
      await pool.query(
        "INSERT INTO workspaces (id, name, created_at, updated_at) VALUES ($1, 'Instagram Studio Test WS', NOW(), NOW())",
        [testWorkspaceId]
      );
    }

    const uRes = await pool.query("SELECT id FROM users LIMIT 1");
    if (uRes.rowCount && uRes.rowCount > 0) {
      testUserId = uRes.rows[0].id;
    } else {
      testUserId = randomUUID();
      await pool.query(
        "INSERT INTO users (id, email, password_hash, full_name, role, status, created_at) VALUES ($1, 'studio@test.local', 'hash', 'Studio Tester', 'admin', 'ACTIVE', NOW())",
        [testUserId]
      );
    }
  });

  test("1. Brand DNA: Retrieves or initializes brand identity with default PENDING_REVIEW status", async () => {
    const brand = await brandService.getBrandDna(testWorkspaceId);
    assert.ok(brand, "Brand DNA record should exist");
    assert.equal(brand.workspaceId, testWorkspaceId);
    assert.ok(["PENDING_REVIEW", "APPROVED", "ACTIVE", "MANUAL"].includes(brand.status));
    assert.ok(Array.isArray(brand.brandColors), "Brand colors must be an array");
    assert.ok(brand.brandColors.length >= 1, "Must have at least one brand color");
  });

  test("2. Brand DNA: Updates profile fields and activates to APPROVED status", async () => {
    const updated = await brandService.updateBrandDna(testWorkspaceId, {
      companyName: "Regulus Capital AI",
      industry: "Quantitative Asset Management",
      communicationTone: "Executive, authoritative, data-driven",
      brandColors: ["#0a0f1d", "#f97316", "#38bdf8"],
      websiteDomain: "www.reguluscapital.ai",
      status: "APPROVED",
    });

    assert.equal(updated.companyName, "Regulus Capital AI");
    assert.equal(updated.industry, "Quantitative Asset Management");
    assert.equal(updated.status, "APPROVED");
    assert.deepEqual(updated.brandColors, ["#0a0f1d", "#f97316", "#38bdf8"]);
  });

  test("3. Creative Variation Lab: Synthesizes 3 distinct Instagram concepts (Luxury, Minimal, Bold)", async () => {
    const result = await variationService.generateThreeVariations({
      workspaceId: testWorkspaceId,
      userId: testUserId,
      topic: "Algorithmic Market Making & Risk Management",
    });

    assert.ok(result.batchId, "Batch ID must be generated");
    assert.equal(result.variations.length, 3, "Must generate exactly 3 variations");

    const styles = result.variations.map((v) => v.conceptStyle);
    assert.ok(styles.includes("PREMIUM_LUXURY"), "Must contain PREMIUM_LUXURY variation");
    assert.ok(styles.includes("MODERN_MINIMAL"), "Must contain MODERN_MINIMAL variation");
    assert.ok(styles.includes("BOLD_ENGAGEMENT"), "Must contain BOLD_ENGAGEMENT variation");

    for (const v of result.variations) {
      assert.equal(v.aspectRatio, "4:5", "Instagram creatives must enforce 4:5 aspect ratio");
      assert.ok(v.headline.length > 5, "Headline must be non-empty");
      assert.ok(v.caption.length > 20, "Caption must contain rich social copy");
      assert.ok(v.prompt.length > 10, "FLUX visual prompt must be generated");
      assert.ok(v.cta.length > 3, "CTA must be present");
    }
  });

  test("4. Carousel Builder: Generates structured 6-slide carousel (Hook -> Content -> CTA)", async () => {
    const carousel = await carouselService.generateCarousel({
      workspaceId: testWorkspaceId,
      userId: testUserId,
      topic: "The 5 Laws of High-Frequency Liquidity",
      slideCount: 6,
      themeStyle: "luxury",
    });

    assert.ok(carousel.id, "Carousel ID must be returned");
    assert.equal(carousel.slideCount, 6, "Slide count must match requested count");
    assert.equal(carousel.aspectRatio, "4:5", "Carousel must use Instagram 4:5 aspect ratio");
    assert.equal(carousel.slides.length, 6, "Must generate 6 structured slides");

    // Check slide roles: Hook at index 1, CTA at index 6
    const hookSlide = carousel.slides.find((s) => s.slideIndex === 1);
    assert.ok(hookSlide, "Must contain Slide 1");
    assert.equal(hookSlide.slideType, "HOOK", "First slide must be HOOK");

    const ctaSlide = carousel.slides.find((s) => s.slideIndex === 6);
    assert.ok(ctaSlide, "Must contain Slide 6");
    assert.equal(ctaSlide.slideType, "CTA", "Final slide must be CTA");

    // Intermediate slides must be CONTENT
    const contentSlides = carousel.slides.filter((s) => s.slideIndex > 1 && s.slideIndex < 6);
    assert.equal(contentSlides.length, 4, "Intermediate slides must be content");
    for (const s of contentSlides) {
      assert.equal(s.slideType, "CONTENT");
      assert.ok(s.headline, "Slide must have a headline");
      assert.ok(s.bodyText, "Slide must have body narrative");
    }
  });

  test("5. Carousel Builder: Reorders slides and updates slide copy", async () => {
    // Generate a 5-slide carousel
    const carousel = await carouselService.generateCarousel({
      workspaceId: testWorkspaceId,
      userId: testUserId,
      topic: "Smart Money Capital Flow",
      slideCount: 5,
    });

    const originalOrder = carousel.slides.map((s) => s.id);
    // Reverse slide order
    const reversedOrder = [...originalOrder].reverse();

    const reordered = await carouselService.reorderSlides({
      carouselId: carousel.id,
      workspaceId: testWorkspaceId,
      orderedSlideIds: reversedOrder,
    });
    assert.equal(reordered.length, 5);
    assert.equal(reordered[0].id, reversedOrder[0], "First slide ID must match reversed first ID");
    assert.equal(reordered[0].slideIndex, 1, "Reordered first slide must have slideIndex 1");

    // Update slide copy
    const targetSlide = reordered[1];
    const updatedSlide = await carouselService.updateSlide({
      carouselId: carousel.id,
      slideId: targetSlide.id,
      workspaceId: testWorkspaceId,
      headline: "Institutional Execution Velocity",
      bodyText: "Orders execute with sub-millisecond precision directly on tier-1 matching engines.",
      badgeText: "VELOCITY RULE",
    });

    assert.equal(updatedSlide.headline, "Institutional Execution Velocity");
    assert.equal(updatedSlide.badgeText, "VELOCITY RULE");
  });

  test("6. Safety & Instagram-Only Isolation: Carousel drafts create Instagram-only post records", async () => {
    const carousel = await carouselService.generateCarousel({
      workspaceId: testWorkspaceId,
      userId: testUserId,
      topic: "Crypto Yield Masterclass",
      slideCount: 5,
    });

    // Populate mock image assets to simulate rendered carousel slides
    await pool.query(
      `UPDATE instagram_carousel_slides
       SET image_url = 'https://assets.contentos.io/sample-slide.png'
       WHERE carousel_id = $1`,
      [carousel.id]
    );

    const draft = await carouselService.saveCarouselAsInstagramDraft({
      carouselId: carousel.id,
      workspaceId: testWorkspaceId,
      userId: testUserId,
    });
    assert.ok(draft.contentId, "Must create a draft content record");

    // Verify in content table that platforms = ["instagram"]
    const contentRes = await pool.query(
      "SELECT platforms, status FROM content WHERE id = $1",
      [draft.contentId]
    );
    assert.equal(contentRes.rowCount, 1);
    const contentRow = contentRes.rows[0];
    assert.equal(contentRow.status, "DRAFT");

    const platforms = typeof contentRow.platforms === "string" ? JSON.parse(contentRow.platforms) : contentRow.platforms;
    assert.deepEqual(platforms, ["instagram"], "Platforms must strictly be ['instagram'] to prevent modifying LinkedIn/Telegram/YouTube/X");
  });
});
