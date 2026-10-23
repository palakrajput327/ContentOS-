import fs from 'node:fs';

let code = fs.readFileSync('server/knowledge/automation.controller.ts', 'utf8').replace(/\r\n/g, '\n');

// 1. Add posterStyle to schema
code = code.replace(
  `postingTime: z.string().regex(/^([01]\\d|2[0-3]):[0-5]\\d$/).default("10:00").optional(),\n  })`,
  `postingTime: z.string().regex(/^([01]\\d|2[0-3]):[0-5]\\d$/).default("10:00").optional(),\n    posterStyle: z.enum(["DIRECT", "BRANDED_CANVAS"]).default("DIRECT").optional(),\n  })`
);

// 2. Update default settings returned in overview
code = code.replace(
  `platforms: ["LinkedIn"],\n        posting_time: "10:00",\n      },`,
  `platforms: ["LinkedIn"],\n        posting_time: "10:00",\n        poster_style: "DIRECT",\n      },`
);

// 3. Update settings PATCH query
const patchTarget = `        await db.query(
          \`INSERT INTO knowledge_automation_settings(workspace_id,actor_id,enabled,horizon_days,cooldown_days,platforms,posting_time)
        VALUES($1,$2,$3,$4,$5,$6,COALESCE($7,'10:00')) 
        ON CONFLICT(workspace_id) DO UPDATE SET actor_id=$2,enabled=$3,horizon_days=$4,cooldown_days=$5,platforms=$6,posting_time=COALESCE($7,knowledge_automation_settings.posting_time,'10:00'),next_run_at=now(),updated_at=now() RETURNING *\`,
          [
            r.workspace.id,
            r.user.id,
            value.enabled,
            value.horizonDays,
            value.cooldownDays,
            JSON.stringify(value.platforms),
            value.postingTime || "10:00",
          ],
        )`;

const patchRep = `        await db.query(
          \`INSERT INTO knowledge_automation_settings(workspace_id,actor_id,enabled,horizon_days,cooldown_days,platforms,posting_time,poster_style)
        VALUES($1,$2,$3,$4,$5,$6,COALESCE($7,'10:00'),COALESCE($8,'DIRECT')) 
        ON CONFLICT(workspace_id) DO UPDATE SET actor_id=$2,enabled=$3,horizon_days=$4,cooldown_days=$5,platforms=$6,posting_time=COALESCE($7,knowledge_automation_settings.posting_time,'10:00'),poster_style=COALESCE($8,knowledge_automation_settings.poster_style,'DIRECT'),next_run_at=now(),updated_at=now() RETURNING *\`,
          [
            r.workspace.id,
            r.user.id,
            value.enabled,
            value.horizonDays,
            value.cooldownDays,
            JSON.stringify(value.platforms),
            value.postingTime || "10:00",
            value.posterStyle || "DIRECT",
          ],
        )`;

code = code.replace(patchTarget, patchRep);

// 4. Add publishPlanNow endpoint before closing class bracket
const publishNowEndpoint = `  @Post("plans/:id/publish-now")
  async publishPlanNow(
    @Req() r: AuthedRequest,
    @Param("id") id: string,
  ) {
    assertPermission(r.workspace.role, "publish");
    const plan = (
      await pool.query(
        "SELECT * FROM knowledge_content_plans WHERE id = $1 AND workspace_id = $2",
        [id, r.workspace.id]
      )
    ).rows[0];
    if (!plan || !plan.content_id) {
      throw new NotFoundException("Plan or content not found.");
    }
    const scheduledPosts = (
      await pool.query(
        "SELECT id FROM scheduled_posts WHERE content_id = $1 AND workspace_id = $2 AND state IN ('ENQUEUED', 'PENDING')",
        [plan.content_id, r.workspace.id]
      )
    ).rows;
    if (!scheduledPosts.length) {
      throw new BadRequestException("No pending scheduled posts found for this plan.");
    }
    const { executePublishRecord } = await import("../publishing.js");
    const results = [];
    for (const sp of scheduledPosts) {
      const res = await executePublishRecord(sp.id, { attemptsMade: 0, maxAttempts: 3 });
      results.push(res);
    }
    const { deliverEmails } = await import("../mail.js");
    await deliverEmails({ limit: 10 });

    return { success: true, count: results.length, results };
  }
}
`;

code = code.replace(/\n\}\s*$/, '\n' + publishNowEndpoint);

fs.writeFileSync('server/knowledge/automation.controller.ts', code, 'utf8');
console.log('Successfully updated automation.controller.ts!');
