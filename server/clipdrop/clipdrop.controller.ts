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

const suggestPromptSchema = z.object({
  contentText: z.string().min(1).max(10000),
  platform: z.string().optional(),
  contextInfo: z.string().optional(),
});

const generateImageSchema = z.object({
  prompt: z.string().trim().min(3).max(2000),
  aspectRatio: z.enum(["1:1", "4:5", "9:16", "16:9"]).default("1:1"),
  headline: z.string().max(200).optional(),
  logoText: z.string().max(80).optional(),
  websiteUrl: z.string().max(120).optional(),
  cta: z.string().max(100).optional(),
  contentId: z.string().uuid().optional(),
  platform: z.string().optional(),
  idempotencyKey: z.string().optional(),
});

const removeBgSchema = z.object({
  assetId: z.string().uuid(),
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

  @Post("generate-image")
  async generateImage(@Req() r: AuthedRequest, @Body() input: unknown) {
    assertPermission(r.workspace.role, "edit");
    const v = generateImageSchema.parse(input);

    return this.clipdropService.generateImage({
      workspaceId: r.workspace.id,
      userId: r.user.id,
      prompt: v.prompt,
      aspectRatio: v.aspectRatio,
      headline: v.headline,
      logoText: v.logoText,
      websiteUrl: v.websiteUrl,
      cta: v.cta,
      contentId: v.contentId,
      platform: v.platform,
      idempotencyKey: v.idempotencyKey,
    });
  }

  @Post("remove-background")
  async removeBackground(@Req() r: AuthedRequest, @Body() input: unknown) {
    assertPermission(r.workspace.role, "edit");
    const v = removeBgSchema.parse(input);

    return this.clipdropService.removeBackground({
      workspaceId: r.workspace.id,
      userId: r.user.id,
      assetId: v.assetId,
    });
  }
}
