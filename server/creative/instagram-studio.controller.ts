import {
  Controller,
  Get,
  Post,
  Put,
  Body,
  Param,
  Req,
  BadRequestException,
} from "@nestjs/common";
import { assertPermission, WorkspaceRequired, type AuthedRequest } from "../security.js";
import { BrandDnaService } from "./brand-dna.service.js";
import { CreativeVariationService } from "./creative-variation.service.js";
import { CarouselService } from "./carousel.service.js";

@Controller("instagram-studio")
export class InstagramStudioController {
  private brandDnaService = new BrandDnaService();
  private variationService = new CreativeVariationService();
  private carouselService = new CarouselService();

  // ==========================================
  // 1. SMART BRAND DNA ENDPOINTS
  // ==========================================

  @WorkspaceRequired()
  @Get("brand-dna")
  async getBrandDna(@Req() r: AuthedRequest) {
    return this.brandDnaService.getBrandDna(r.workspace.id);
  }

  @WorkspaceRequired()
  @Post("brand-dna/extract")
  async extractBrandDna(
    @Req() r: AuthedRequest,
    @Body() body: { documentId?: string; rawText?: string; url?: string }
  ) {
    assertPermission(r.workspace.role, "edit");
    return this.brandDnaService.extractBrandDna({
      workspaceId: r.workspace.id,
      documentId: body?.documentId,
      rawText: body?.rawText,
      url: body?.url,
    });
  }

  @WorkspaceRequired()
  @Put("brand-dna")
  async updateBrandDna(@Req() r: AuthedRequest, @Body() body: any) {
    assertPermission(r.workspace.role, "edit");
    return this.brandDnaService.updateBrandDna(r.workspace.id, body || {});
  }

  @WorkspaceRequired()
  @Post("brand-dna/upload-logo")
  async uploadBrandLogo(
    @Req() r: AuthedRequest,
    @Body() body: { dataUrl: string; filename?: string }
  ) {
    assertPermission(r.workspace.role, "edit");
    if (!body?.dataUrl || !body.dataUrl.includes(",")) {
      throw new BadRequestException("Valid base64 dataUrl is required for logo upload.");
    }
    const [header, base64Data] = body.dataUrl.split(",");
    const mimeMatch = header.match(/data:([^;]+);/);
    const mimeType = mimeMatch ? mimeMatch[1] : "image/png";
    const buffer = Buffer.from(base64Data, "base64");
    const filename = body.filename || `logo_${Date.now()}.png`;

    return this.brandDnaService.uploadBrandLogo({
      workspaceId: r.workspace.id,
      userId: r.user.id,
      buffer,
      mimeType,
      filename,
    });
  }

  // ==========================================
  // 2. CREATIVE VARIATION LAB ENDPOINTS
  // ==========================================

  @WorkspaceRequired()
  @Post("variations/generate")
  async generateVariations(
    @Req() r: AuthedRequest,
    @Body() body: { topic: string; documentId?: string }
  ) {
    assertPermission(r.workspace.role, "edit");
    if (!body?.topic || body.topic.trim().length < 3) {
      throw new BadRequestException("Please provide a topic or concept idea (at least 3 characters).");
    }
    return this.variationService.generateThreeVariations({
      workspaceId: r.workspace.id,
      userId: r.user.id,
      topic: body.topic.trim(),
      documentId: body.documentId,
    });
  }

  @WorkspaceRequired()
  @Get("variations/batch/:batchId")
  async getBatchVariations(
    @Req() r: AuthedRequest,
    @Param("batchId") batchId: string
  ) {
    return this.variationService.getBatchVariations(batchId, r.workspace.id);
  }

  @WorkspaceRequired()
  @Post("variations/:id/generate-image")
  async generateVariationImage(
    @Req() r: AuthedRequest,
    @Param("id") variationId: string,
    @Body() body: { prompt?: string }
  ) {
    assertPermission(r.workspace.role, "edit");
    return this.variationService.generateVariationImage({
      variationId,
      workspaceId: r.workspace.id,
      userId: r.user.id,
      customPrompt: body?.prompt,
    });
  }

  @WorkspaceRequired()
  @Post("variations/:id/regenerate")
  async regenerateVariation(
    @Req() r: AuthedRequest,
    @Param("id") variationId: string,
    @Body() body: { prompt?: string }
  ) {
    assertPermission(r.workspace.role, "edit");
    return this.variationService.regenerateSingleVariation({
      variationId,
      workspaceId: r.workspace.id,
      userId: r.user.id,
      customPrompt: body?.prompt,
    });
  }

  @WorkspaceRequired()
  @Post("variations/:id/save-draft")
  async saveVariationAsDraft(
    @Req() r: AuthedRequest,
    @Param("id") variationId: string
  ) {
    assertPermission(r.workspace.role, "schedule");
    return this.variationService.saveVariationAsInstagramDraft({
      variationId,
      workspaceId: r.workspace.id,
      userId: r.user.id,
    });
  }

  // ==========================================
  // 3. INSTAGRAM CAROUSEL BUILDER ENDPOINTS
  // ==========================================

  @WorkspaceRequired()
  @Post("carousels/generate")
  async generateCarousel(
    @Req() r: AuthedRequest,
    @Body() body: { topic: string; slideCount?: number; documentId?: string; themeStyle?: string }
  ) {
    assertPermission(r.workspace.role, "edit");
    if (!body?.topic || body.topic.trim().length < 3) {
      throw new BadRequestException("Please provide a topic or PDF context for carousel generation.");
    }
    return this.carouselService.generateCarousel({
      workspaceId: r.workspace.id,
      userId: r.user.id,
      topic: body.topic.trim(),
      slideCount: body.slideCount,
      documentId: body.documentId,
      themeStyle: body.themeStyle,
    });
  }

  @WorkspaceRequired()
  @Get("carousels")
  async listCarousels(@Req() r: AuthedRequest) {
    return this.carouselService.listCarousels(r.workspace.id);
  }

  @WorkspaceRequired()
  @Get("carousels/:id")
  async getCarousel(
    @Req() r: AuthedRequest,
    @Param("id") carouselId: string
  ) {
    return this.carouselService.getCarousel(carouselId, r.workspace.id);
  }

  @WorkspaceRequired()
  @Put("carousels/:id/reorder")
  async reorderCarouselSlides(
    @Req() r: AuthedRequest,
    @Param("id") carouselId: string,
    @Body() body: { orderedSlideIds: string[] }
  ) {
    assertPermission(r.workspace.role, "edit");
    if (!Array.isArray(body?.orderedSlideIds) || body.orderedSlideIds.length === 0) {
      throw new BadRequestException("orderedSlideIds array is required.");
    }
    return this.carouselService.reorderSlides({
      carouselId,
      workspaceId: r.workspace.id,
      orderedSlideIds: body.orderedSlideIds,
    });
  }

  @WorkspaceRequired()
  @Put("carousels/:id/slides/:slideId")
  async updateCarouselSlide(
    @Req() r: AuthedRequest,
    @Param("id") carouselId: string,
    @Param("slideId") slideId: string,
    @Body() body: { headline?: string; bodyText?: string; badgeText?: string }
  ) {
    assertPermission(r.workspace.role, "edit");
    return this.carouselService.updateSlide({
      slideId,
      carouselId,
      workspaceId: r.workspace.id,
      headline: body?.headline,
      bodyText: body?.bodyText,
      badgeText: body?.badgeText,
    });
  }

  @WorkspaceRequired()
  @Post("carousels/:id/slides/:slideId/render")
  async renderCarouselSlide(
    @Req() r: AuthedRequest,
    @Param("id") _carouselId: string,
    @Param("slideId") slideId: string,
    @Body() body: { generateBgArt?: boolean }
  ) {
    assertPermission(r.workspace.role, "edit");
    return this.carouselService.renderSlideCanvas({
      slideId,
      workspaceId: r.workspace.id,
      userId: r.user.id,
      generateBgArt: Boolean(body?.generateBgArt),
    });
  }

  @WorkspaceRequired()
  @Post("carousels/:id/render-all")
  async renderAllCarouselSlides(
    @Req() r: AuthedRequest,
    @Param("id") carouselId: string
  ) {
    assertPermission(r.workspace.role, "edit");
    return this.carouselService.renderAllSlides({
      carouselId,
      workspaceId: r.workspace.id,
      userId: r.user.id,
    });
  }

  @WorkspaceRequired()
  @Post("carousels/:id/save-draft")
  async saveCarouselAsDraft(
    @Req() r: AuthedRequest,
    @Param("id") carouselId: string
  ) {
    assertPermission(r.workspace.role, "schedule");
    return this.carouselService.saveCarouselAsInstagramDraft({
      carouselId,
      workspaceId: r.workspace.id,
      userId: r.user.id,
    });
  }

  @WorkspaceRequired()
  @Post("carousels/:id/publish")
  async publishCarouselNow(
    @Req() r: AuthedRequest,
    @Param("id") carouselId: string
  ) {
    assertPermission(r.workspace.role, "schedule");
    return this.carouselService.publishCarouselNow({
      carouselId,
      workspaceId: r.workspace.id,
      userId: r.user.id,
    });
  }
}

