import "reflect-metadata";
import {
  Module,
  Catch,
  HttpException,
  type ExceptionFilter,
  type ArgumentsHost,
} from "@nestjs/common";
import { NestFactory, APP_GUARD } from "@nestjs/core";
import { SwaggerModule, DocumentBuilder } from "@nestjs/swagger";
import { randomUUID } from "node:crypto";
import express from "express";
import cookieParser from "cookie-parser";
import helmet from "helmet";
import { createRateLimiter } from './rate-limiter.js';
import { queueBackend } from './queue-backend.js';
import { fileURLToPath } from "node:url";
import { ZodError } from "zod";
import { map } from "rxjs";
import { AuthGuard, hash, type AuthedRequest } from "./security.js";
import { AuthController } from "./auth.controller.js";
import { WorkspaceController } from "./workspace.controller.js";
import { ContentController } from "./content.controller.js";
import { SocialController } from "./social.controller.js";
import { AIController } from "./ai.controller.js";
import { AnalyticsController } from "./analytics.controller.js";
import { ClipdropController } from "./clipdrop/clipdrop.controller.js";
import { ClipdropService } from "./clipdrop/clipdrop.service.js";
import { ProviderError } from "./providers/social.js";
import { pool } from "./db.js";
import { KnowledgeAutomationController } from "./knowledge/automation.controller.js";
import {VisualMediaController} from './documents/visual-media.controller.js';
import {DocumentsController} from './documents/documents.controller.js';
import {KnowledgeController} from './knowledge/knowledge.controller.js';
import {StorageController} from './storage/storage.controller.js';
@Catch()
class ErrorFilter implements ExceptionFilter {
  catch(error: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const req = ctx.getRequest<AuthedRequest>();
    let status = 500,
      message = "Something went wrong. Please try again.";
    if (error instanceof ZodError) {
      status = 400;
      message = error.issues
        .map((i) => `${i.path.join(".")}: ${i.message}`)
        .join("; ");
    } else if (error instanceof HttpException) {
      status = error.getStatus();
      message = error.message;
    } else if (error instanceof ProviderError) {
      status = 502;
      message =
        error.code === "RECONNECT_REQUIRED"
          ? "Authorization expired. Reconnect your account."
          : `The social provider could not complete the request (${error.code}).`;
    }
    if (status >= 500) {
      console.error(
        JSON.stringify({
          event: "api_error",
          requestId: req.requestId,
          status,
          path: req.path,
          message,
        }),
      );
    }
    ctx
      .getResponse()
      .status(status)
      .json({ data: null, message, requestId: req.requestId });
  }
}
@Module({
  controllers: [
    AuthController,
    WorkspaceController,
    ContentController,
    SocialController,
    AIController,
    KnowledgeAutomationController,
    VisualMediaController,
    DocumentsController,
    KnowledgeController,
    StorageController,
    AnalyticsController,
    ClipdropController,
  ],
  providers: [{ provide: APP_GUARD, useClass: AuthGuard }, ClipdropService],
})
class AppModule {}
export async function bootstrap() {
  for (const key of [
    "DATABASE_URL",
    "TOKEN_ENCRYPTION_KEY",
    "APP_ORIGIN",
  ])
    if (!process.env[key]) throw new Error(`Missing ${key}`);
  if (!/^[a-f0-9]{64}$/i.test(process.env.TOKEN_ENCRYPTION_KEY!))
    throw new Error("Invalid token encryption key");
  const origin = new URL(process.env.APP_ORIGIN!);
  if (process.env.NODE_ENV === "production" && origin.protocol !== "https:")
    throw new Error("Production requires HTTPS");
  await pool.query("SELECT 1");
  if (queueBackend() === 'bullmq' && !process.env.REDIS_URL) throw new Error('Missing REDIS_URL');
  if (queueBackend() === 'postgres') await pool.query('SELECT id FROM queue_jobs LIMIT 1');
  const limiter = await createRateLimiter();
  const app = await NestFactory.create(AppModule, {
    logger: ["error", "warn"],
    bodyParser: false,
  });
  app.setGlobalPrefix("api/v1");
  app.use(helmet());
  app.use(express.json({ limit: "256kb" }));
  app.use(cookieParser());
  app.use(
    async (
      req: express.Request,
      res: express.Response,
      next: express.NextFunction,
    ) => {
      const id = randomUUID();
      (req as AuthedRequest).requestId = id;
      res.setHeader("X-Request-Id", id);
      if (!req.path.startsWith("/api/")) return next();
      res.setHeader("Cache-Control", "no-store");
      if (
        !["GET", "HEAD", "OPTIONS"].includes(req.method) &&
        req.headers.origin !== origin.origin
      )
        return res
          .status(403)
          .json({ message: "Request origin is not allowed.", requestId: id });
      try {
        const auth = req.path.startsWith("/api/v1/auth");
        const ai = req.path.startsWith("/api/v1/ai");
        const bucket = auth ? "auth" : ai ? "ai" : "api";
        const key = `limit:${bucket}:${hash(req.ip || req.socket.remoteAddress || "unknown")}`;
        const count = await limiter.count(key,60);
        if (count > (auth ? 20 : ai ? 10 : 180)) {
          res.setHeader("Retry-After", "60");
          return res
            .status(429)
            .json({
              message: "Too many requests. Please wait a minute.",
              requestId: id,
            });
        }
        next();
      } catch {
        return res
          .status(503)
          .json({
            message: "The service is temporarily unavailable.",
            requestId: id,
          });
      }
    },
  );
  app.useGlobalFilters(new ErrorFilter());
  app.useGlobalInterceptors({
    intercept: (_context, next) =>
      next.handle().pipe(map((data) => ({ data }))),
  });
  if (process.env.NODE_ENV !== "production") {
    const config = new DocumentBuilder()
      .setTitle("ContentOS MVP API")
      .setVersion("1.0")
      .addCookieAuth("contentos_session")
      .addApiKey(
        { type: "apiKey", in: "header", name: "X-Workspace-Id" },
        "workspace",
      )
      .build();
    SwaggerModule.setup(
      "api/docs",
      app,
      SwaggerModule.createDocument(app, config),
    );
  }
  await app.init();
  const server = app.getHttpAdapter().getInstance();
  const root = fileURLToPath(new URL("../dist/", import.meta.url));
  server.use(express.static(root));
  server.get("/{*splat}", (req: express.Request, res: express.Response) =>
    req.path.startsWith("/api/")
      ? res.status(404).json({ message: "Endpoint not found" })
      : res.sendFile(`${root}/index.html`),
  );
  await app.listen(Number(process.env.PORT || 3001), "0.0.0.0");

  // Built-in Auto-Scheduler Loop: Checks every 30s for due posts and publishes automatically
  const autoPublishInterval = setInterval(async () => {
    try {
      const { relayScheduledPosts } = await import("./cron-tasks.js");
      await relayScheduledPosts(pool);

      const duePosts = (await pool.query(
        `SELECT id FROM scheduled_posts 
         WHERE state = 'ENQUEUED' AND execute_at <= NOW()
         ORDER BY execute_at ASC LIMIT 10`
      )).rows;

      for (const sp of duePosts) {
        const { executePublishRecord } = await import("./publishing.js");
        try {
          await executePublishRecord(sp.id, { attemptsMade: 0, maxAttempts: 3 });
        } catch (postErr) {
          console.warn(`[ContentOS] Auto-publish failed for post ${sp.id}:`, (postErr as Error).message);
        }
      }

      // Immediately dispatch notification emails to user's registered Gmail
      try {
        const { deliverEmails } = await import("./mail.js");
        await deliverEmails({ limit: 10 });
      } catch (mailErr) {
        console.warn("[ContentOS] Auto-scheduler email dispatch warning:", (mailErr as Error).message);
      }
    } catch (schedErr) {
      console.warn("[ContentOS] Auto-scheduler poller warning:", (schedErr as Error).message);
    }
  }, 30000);

  const shutdown = async () => {
    clearInterval(autoPublishInterval);
    await app.close();
    await limiter.quit();
    await pool.end();
  };
  process.on("SIGTERM", () => void shutdown());
  process.on("SIGINT", () => void shutdown());
  console.log(
    JSON.stringify({
      event: "api_ready",
      port: Number(process.env.PORT || 3001),
    }),
  );
  return app;
}
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1])
  bootstrap().catch((e) => {
    console.error(e.message);
    process.exit(1);
  });
