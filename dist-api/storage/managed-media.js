import { randomUUID } from "node:crypto";
import { pool } from "../db.js";
import { BadRequestException } from "@nestjs/common";
// Reserve bytes before a provider write, so quota rejection cannot create a new object.
export async function uploadManagedMedia(input, db = pool) {
    const assetId = input.assetId || randomUUID();
    try {
        await db.query(`INSERT INTO media_assets(id,workspace_id,type,storage_provider,bucket,object_key,mime_type,size_bytes,original_filename,status,metadata,created_by)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,'PENDING',$10,$11)`, [
            assetId,
            input.workspaceId,
            input.type,
            input.provider.constructor.name.includes("Local") ? "local" : "s3",
            input.bucket,
            input.objectKey,
            input.mimeType,
            input.body.length,
            input.filename,
            JSON.stringify(input.metadata || {}),
            input.userId || null,
        ]);
    }
    catch (error) {
        if (error.code === "P0001" &&
            error.message.startsWith("Workspace storage quota exceeded"))
            throw new BadRequestException("Workspace storage quota exceeded. Free managed storage or increase the workspace storage limit.");
        throw error;
    }
    try {
        await input.provider.upload({
            bucket: input.bucket,
            objectKey: input.objectKey,
            body: input.body,
            mimeType: input.mimeType,
        });
        await db.query("UPDATE media_assets SET status='COMPLETED' WHERE id=$1 AND workspace_id=$2", [assetId, input.workspaceId]);
        return assetId;
    }
    catch (error) {
        await db.query("UPDATE media_assets SET status='FAILED' WHERE id=$1 AND workspace_id=$2", [assetId, input.workspaceId]);
        throw error;
    }
}
