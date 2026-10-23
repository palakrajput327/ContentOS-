var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
import { loadEnvFile } from "node:process";
try {
    loadEnvFile(".env");
}
catch {
    // cPanel may also provide environment variables directly.
}
import "reflect-metadata";
import { Module, Catch, HttpException, Injectable, UnauthorizedException, ForbiddenException, BadRequestException, Controller, Get, ServiceUnavailableException, } from "@nestjs/common";
import { NestFactory, APP_GUARD, Reflector } from "@nestjs/core";
import { SwaggerModule, DocumentBuilder } from "@nestjs/swagger";
import { randomUUID } from "node:crypto";
import express from "express";
import cookieParser from "cookie-parser";
import helmet from "helmet";
import { Redis } from "ioredis";
import { ZodError } from "zod";
import { map } from "rxjs";
import { fileURLToPath } from "node:url";
import { pool } from "./db.js";
import { loadConfig } from "./config.js";
import { hash, Public } from "./security.js";
import { PhaseAuthController } from "./phase-auth.controller.js";
import { WorkspaceController } from "./workspace.controller.js";
import { WorkspaceSessionController } from "./workspace-session.js";
import { ContentController } from "./content.controller.js";
import { DashboardController } from "./dashboard.controller.js";
import { AdminController, AdminGuard } from "./admin.controller.js";
let redis;
let PhaseGuard = class PhaseGuard {
    reflector;
    adminGuard;
    constructor(reflector, adminGuard) {
        this.reflector = reflector;
        this.adminGuard = adminGuard;
    }
    async canActivate(ctx) {
        if (this.reflector.getAllAndOverride("public", [
            ctx.getHandler(),
            ctx.getClass(),
        ]))
            return true;
        const r = ctx.switchToHttp().getRequest();
        if (r.path.startsWith("/api/v1/admin")) {
            return this.adminGuard.canActivate(ctx);
        }
        const raw = r.cookies?.contentos_session;
        if (typeof raw !== "string")
            throw new UnauthorizedException("Please log in to continue.");
        const found = await pool.query("SELECT u.id,u.name,u.email FROM auth_sessions s JOIN users u ON u.id=s.user_id WHERE s.access_hash=$1 AND s.revoked_at IS NULL AND s.access_expires_at>now() AND s.absolute_expires_at>now() AND u.email_verified_at IS NOT NULL", [hash(raw)]);
        if (!found.rowCount)
            throw new UnauthorizedException("Your session expired. Please log in again.");
        r.user = found.rows[0];
        if (this.reflector.getAllAndOverride("workspace", [
            ctx.getHandler(),
            ctx.getClass(),
        ])) {
            const wid = r.header("X-Workspace-Id");
            if (!wid || !/^[a-f0-9-]{36}$/i.test(wid))
                throw new BadRequestException("Select a workspace.");
            const m = await pool.query("SELECT role FROM workspace_members WHERE workspace_id=$1 AND user_id=$2", [wid, r.user.id]);
            if (!m.rowCount)
                throw new ForbiddenException("Workspace access denied.");
            r.workspace = { id: wid, role: m.rows[0].role };
        }
        return true;
    }
};
PhaseGuard = __decorate([
    Injectable(),
    __metadata("design:paramtypes", [Reflector, AdminGuard])
], PhaseGuard);
let ErrorFilter = class ErrorFilter {
    catch(e, h) {
        const c = h.switchToHttp(), r = c.getRequest();
        let status = 500, message = "The request could not be completed. Please try again.";
        if (e instanceof ZodError) {
            status = 400;
            message = e.issues
                .map((i) => `${i.path.join(".")}: ${i.message}`)
                .join("; ");
        }
        else if (e instanceof HttpException) {
            status = e.getStatus();
            message = e.message;
        }
        console.error(JSON.stringify({
            event: "api_error",
            status,
            path: r.path,
            requestId: r.requestId,
        }));
        c.getResponse()
            .status(status)
            .json({
            data: null,
            error: {
                code: status === 500 ? "INTERNAL_ERROR" : `HTTP_${status}`,
                message,
            },
            message,
            requestId: r.requestId,
        });
    }
};
ErrorFilter = __decorate([
    Catch()
], ErrorFilter);
let HealthController = class HealthController {
    health() {
        return { status: "ok", phase: "authentication" };
    }
    async ready() {
        try {
            await pool.query("SELECT 1");
            await redis.ping();
            return { status: "ready", postgres: "ok", redis: "ok" };
        }
        catch {
            throw new ServiceUnavailableException("A required service is unavailable.");
        }
    }
};
__decorate([
    Public(),
    Get(),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", void 0)
], HealthController.prototype, "health", null);
__decorate([
    Public(),
    Get("ready"),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", Promise)
], HealthController.prototype, "ready", null);
HealthController = __decorate([
    Controller("health")
], HealthController);
import { SocialController } from "./social.controller.js";
import { StorageController } from "./storage/storage.controller.js";
import { DocumentsController } from "./documents/documents.controller.js";
import { KnowledgeController } from "./knowledge/knowledge.controller.js";
let PhaseModule = class PhaseModule {
};
PhaseModule = __decorate([
    Module({
        controllers: [
            PhaseAuthController,
            HealthController,
            WorkspaceController,
            WorkspaceSessionController,
            ContentController,
            DashboardController,
            AdminController,
            SocialController,
            StorageController,
            DocumentsController,
            KnowledgeController,
        ],
        providers: [AdminGuard, { provide: APP_GUARD, useClass: PhaseGuard }],
    })
], PhaseModule);
export async function bootstrap() {
    const config = loadConfig();
    redis = new Redis(config.REDIS_URL, {
        maxRetriesPerRequest: 1,
        connectTimeout: 5000,
    });
    redis.on("error", () => console.error(JSON.stringify({ event: "redis_unavailable" })));
    await pool.query("SELECT 1");
    await redis.ping();
    const app = await NestFactory.create(PhaseModule, {
        logger: ["error", "warn"],
        bodyParser: false,
    });
    app.setGlobalPrefix("api/v1");
    const allowedOrigins = [
        new URL(config.APP_URL).origin,
        "http://localhost:5173",
        "http://127.0.0.1:5173",
    ];
    app.enableCors({
        origin: allowedOrigins,
        credentials: true,
        methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
        allowedHeaders: ["Content-Type", "X-Workspace-Id"],
        maxAge: 600,
    });
    app.use(helmet());
    app.use((req, res, next) => {
        const id = randomUUID();
        req.requestId = id;
        res.setHeader("X-Request-Id", id);
        res.setHeader("Cache-Control", "no-store");
        const reqOrigin = req.headers.origin;
        if (req.path.startsWith("/api/") &&
            !["GET", "HEAD", "OPTIONS"].includes(req.method) &&
            reqOrigin &&
            !allowedOrigins.includes(reqOrigin))
            return res.status(403).json({
                data: null,
                message: "Request origin is not allowed.",
                requestId: id,
            });
        next();
    });
    app.use(express.json({ limit: "16kb" }));
    app.use(cookieParser());
    app.use(async (req, res, next) => {
        if (!req.path.startsWith("/api/v1/auth/"))
            return next();
        try {
            const read = req.method === "GET" || req.path.endsWith("/refresh");
            const limit = read ? 120 : 20;
            const ip = hash(req.ip || req.socket.remoteAddress || "unknown");
            const key = `auth-rate:${read ? "read" : "write"}:${ip}`;
            const script = "local n=redis.call('INCR',KEYS[1]); if n==1 then redis.call('EXPIRE',KEYS[1],ARGV[1]) end; return n";
            const n = Number(await redis.eval(script, 1, key, 60));
            if (n > limit) {
                res.setHeader("Retry-After", "60");
                return res.status(429).json({
                    data: null,
                    message: "Too many attempts. Please wait one minute.",
                    requestId: req.requestId,
                });
            }
            next();
        }
        catch {
            return res.status(503).json({
                data: null,
                message: "Authentication is temporarily unavailable.",
                requestId: req.requestId,
            });
        }
    });
    app.useGlobalFilters(new ErrorFilter());
    app.useGlobalInterceptors({
        intercept: (ctx, next) => next.handle().pipe(map((data) => ({
            data,
            requestId: ctx.switchToHttp().getRequest().requestId,
        }))),
    });
    if (config.APP_ENV !== "production")
        SwaggerModule.setup("api/docs", app, SwaggerModule.createDocument(app, new DocumentBuilder()
            .setTitle("ContentOS Authentication API")
            .setVersion("1.0")
            .addCookieAuth("contentos_session")
            .build()));
    const server = app.getHttpAdapter().getInstance();
    const root = fileURLToPath(new URL("../dist/", import.meta.url));
    // Serve the built React/Vite frontend before Nest registers its 404 handler.
    server.use(express.static(root));
    // SPA fallback: all non-API GET requests return the frontend index.html.
    server.use((req, res, next) => {
        if (req.method === "GET" && !req.path.startsWith("/api/")) {
            return res.sendFile(`${root}/index.html`);
        }
        next();
    });
    await app.init();
    // Respect cPanel/Passenger PORT when provided; otherwise use app config.
    const port = Number(process.env.PORT || config.PORT || 3001);
    await app.listen(port, "0.0.0.0");
    console.log(JSON.stringify({
        event: "auth_api_ready",
        port,
    }));
    let closing = false;
    const close = async () => {
        if (closing)
            return;
        closing = true;
        try {
            await app.close();
        }
        catch (error) {
            console.error("App shutdown error:", error);
        }
        try {
            if (redis.status !== "end") {
                await redis.quit();
            }
        }
        catch {
            redis.disconnect();
        }
        try {
            await pool.end();
        }
        catch (error) {
            console.error("Postgres shutdown error:", error);
        }
    };
    process.once("SIGTERM", () => void close());
    process.once("SIGINT", () => void close());
    return app;
}
// if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1])
//   bootstrap().catch(() => {
//     console.error(
//       "Authentication API startup failed. Check configuration and local services.",
//     );
//     process.exit(1);
//   });
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
    bootstrap().catch((error) => {
        console.error("Authentication API startup failed:", error);
        process.exit(1);
    });
}
