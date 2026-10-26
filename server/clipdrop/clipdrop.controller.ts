import {
  Controller,
  Post,
  Body,
  Req,
  BadRequestException,
} from "@nestjs/common";
import { z } from "zod";
import { WorkspaceRequired, assertPermission, type AuthedRequest } from "../security.js";
import { ClipdropService } from "./clipdrop.service.js";
import { assertWorkspaceActive } from "../billing/entitlement.service.js";

const suggestPromptSchema = z.object({
  contentText: z.string().min(1).max(10000),
  platform: z.string().optional(),
  contextInfo: z.string().optional(),
});

const suggestPosterPromptSchema = z.object({
  knowledgeConcept: z.string().min(1).max(5000),
  excerpt: z.string().max(2000).optional(),
  sourceVisualContext: z.string().max(1000).optional(),
  title: z.string().max(200).optional(),
  platform: z.string().optional(),
});

const generateImageSchema = z.object({
  prompt: z.string().trim().min(3).max(2000),
  engine: z.enum(["clipdrop", "flux"]).default("clipdrop"),
  stylePreset: z.string().optional(),
  aspectRatio: z.enum(["1:1", "4:5", "9:16", "16:9"]).default("1:1"),
  headline: z.string().max(200).optional(),
  logoText: z.string().max(80).optional(),
  websiteUrl: z.string().max(120).optional(),
  cta: z.string().max(100).optional(),
  enableOverlay: z.boolean().default(false),
  contentId: z.string().uuid().optional(),
  platform: z.string().optional(),
  idempotencyKey: z.string().optional(),
});

const removeBgSchema = z.object({
  assetId: z.string().uuid(),
});

const attachAndSaveSchema = z.object({
  contentId: z.string().uuid().optional(),
  title: z
    .string()
    .trim()
    .max(200)
    .optional()
    .transform((v) => (v && v.trim() ? v : "AI Visual Post"))
    .default("AI Visual Post"),
  body: z
    .string()
    .trim()
    .max(10000)
    .optional()
    .transform((v) => (v && v.trim() ? v : "Visual created with AI Studio"))
    .default("Visual created with AI Studio"),
  platforms: z.array(z.string()).min(1),
  assetId: z.string().uuid(),
  mediaUrl: z.string().min(1),
  status: z.enum(["DRAFT", "NEEDS_REVIEW"]).default("NEEDS_REVIEW"),
});

@WorkspaceRequired()
@Controller("clipdrop")
export class ClipdropController {
  constructor(private readonly clipdropService: ClipdropService) {}

  @Post("suggest-prompt")
  async suggestPrompt(@Req() r: AuthedRequest, @Body() input: unknown) {
    assertPermission(r.workspace.role, "edit");
    const v = suggestPromptSchema.parse(input);
    return this.clipdropService.suggestPrompt(v.contentText, v.platform, v.contextInfo);
  }

  @Post("suggest-poster-prompt")
  async suggestPosterPrompt(@Req() r: AuthedRequest, @Body() input: unknown) {
    assertPermission(r.workspace.role, "edit");
    const v = suggestPosterPromptSchema.parse(input);
    const { pool } = await import("../db.js");
    const ws = (await pool.query("SELECT brand_settings FROM workspaces WHERE id=$1", [r.workspace.id])).rows[0];
    const brand = ws?.brand_settings || {};
    return this.clipdropService.suggestPosterPrompt({
      knowledgeConcept: v.knowledgeConcept,
      excerpt: v.excerpt,
      sourceVisualContext: v.sourceVisualContext,
      title: v.title,
      brand,
      platform: v.platform,
    });
  }

  @Post("generate-image")
  async generateImage(@Req() r: AuthedRequest, @Body() input: unknown) {
    assertPermission(r.workspace.role, "edit");
    await assertWorkspaceActive(r.workspace.id, "AI visual generation");
    const v = generateImageSchema.parse(input);

    return this.clipdropService.generateImage({
      workspaceId: r.workspace.id,
      userId: r.user.id,
      prompt: v.prompt,
      engine: v.engine,
      stylePreset: v.stylePreset,
      aspectRatio: v.aspectRatio,
      headline: v.headline,
      logoText: v.logoText,
      websiteUrl: v.websiteUrl,
      cta: v.cta,
      enableOverlay: v.enableOverlay,
      contentId: v.contentId,
      platform: v.platform,
      idempotencyKey: v.idempotencyKey,
    });
  }

  @Post("remove-background")
  async removeBackground(@Req() r: AuthedRequest, @Body() input: unknown) {
    assertPermission(r.workspace.role, "edit");
    await assertWorkspaceActive(r.workspace.id, "AI image processing");
    const v = removeBgSchema.parse(input);

    return this.clipdropService.removeBackground({
      workspaceId: r.workspace.id,
      userId: r.user.id,
      assetId: v.assetId,
    });
  }

  @Post("attach-and-save")
  async attachAndSave(@Req() r: AuthedRequest, @Body() input: unknown) {
    assertPermission(r.workspace.role, "edit");
    const v = attachAndSaveSchema.parse(input);

    return this.clipdropService.attachAndSave({
      workspaceId: r.workspace.id,
      userId: r.user.id,
      contentId: v.contentId,
      title: v.title,
      body: v.body,
      platforms: v.platforms,
      assetId: v.assetId,
      mediaUrl: v.mediaUrl,
      status: v.status,
    });
  }
}
