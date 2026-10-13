import { Controller, Post, Req, Param, Body } from "@nestjs/common";
import { z } from "zod";
import { pool, transaction } from "../db.js";
import {
  WorkspaceRequired,
  assertPermission,
  type AuthedRequest,
} from "../security.js";
import { sourceReference } from "./source-original.js";
import { VisualKnowledgeService } from "./visual-knowledge.service.js";
import {
  SourcePosterService,
  sourcePosterSchema,
  approveSourceReuse,
} from "./source-poster.js";

@WorkspaceRequired()
@Controller("documents")
export class VisualMediaController {
  @Post(":documentId/source-media/:sourceId/analyze")
  async analyze(
    @Req() r: AuthedRequest,
    @Param("documentId") documentId: string,
    @Param("sourceId") sourceId: string,
    @Body() input: unknown,
  ) {
    assertPermission(r.workspace.role, "edit");
    const value = z
      .object({ includeVision: z.boolean().default(false) })
      .parse(input);
    return new VisualKnowledgeService().analyze(
      r.workspace.id,
      documentId,
      sourceId,
      r.user.id,
      value.includeVision,
    );
  }
  @Post(":documentId/source-media/:sourceId/reuse")
  async reuse(
    @Req() r: AuthedRequest,
    @Param("documentId") documentId: string,
    @Param("sourceId") sourceId: string,
    @Body() input: unknown,
  ) {
    assertPermission(r.workspace.role, "edit");
    const value = z
      .object({
        allowed: z.boolean(),
        rightsConfirmed: z.boolean().default(false),
      })
      .refine(
        (v) => !v.allowed || v.rightsConfirmed,
        "Confirm that your workspace may reuse this image.",
      )
      .parse(input);
    return transaction(async (db) => {
      const source = await sourceReference(
        db,
        r.workspace.id,
        documentId,
        sourceId,
      );
      return approveSourceReuse(
        db,
        r.workspace.id,
        source,
        r.user.id,
        value.allowed,
      );
    });
  }
  @Post(":documentId/source-media/:sourceId/poster")
  async poster(
    @Req() r: AuthedRequest,
    @Param("documentId") documentId: string,
    @Param("sourceId") sourceId: string,
    @Body() input: unknown,
  ) {
    assertPermission(r.workspace.role, "edit");
    return new SourcePosterService().create(
      r.workspace.id,
      documentId,
      sourceId,
      r.user.id,
      sourcePosterSchema.parse(input),
    );
  }
}
