import express from "express";
import type { Express, NextFunction, Request, Response } from "express";
import { randomBytes } from "node:crypto";
import { applicationPORT } from "../config/configuration.js";

export const app: Express = express();
app.disable("x-powered-by");

let pinnedOrigin: string | undefined;
export function pinOrigin(origin: string): void {
    pinnedOrigin = origin;
}


const allowedHosts = new Set([`127.0.0.1:${applicationPORT}`, `localhost:${applicationPORT}`]);
app.use((req, _res, next) => {
    // Chrome leaves Origin off an extension's GET requests, so only a present, wrong Origin is rejected
    const origin = req.get("origin");
    const originOk = origin === undefined || (pinnedOrigin ? origin === pinnedOrigin : origin.startsWith("chrome-extension://"));
    if (!allowedHosts.has(req.get("host") ?? "") || req.get("x-locksmate") !== "1" || !originOk) {
        req.socket.destroy();
        return;
    }
    next();
});

app.use(express.json());

app.get("/api/health", (_req, res) => {
    res.json({ status: "success" });
});

const SESSION_MS = 15 * 60_000;
const sessions = new Map<string, { key: Buffer; expires: number }>();

export function createSession(key: Buffer): string {
    const token = randomBytes(32).toString("hex");
    sessions.set(token, { key, expires: Date.now() + SESSION_MS });
    return token;
}

export function endSession(req: Request): void {
    sessions.delete(req.get("authorization")?.replace("Bearer ", "") ?? "");
}

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
    const token = req.get("authorization")?.replace("Bearer ", "") ?? "";
    const session = sessions.get(token);
    if (!session || session.expires < Date.now()) {
        sessions.delete(token);
        res.status(401).json({ error: "locked" });
        return;
    }
    session.expires = Date.now() + SESSION_MS;
    res.locals.key = session.key;
    next();
}

export function finishApp(): void {
    app.use((req: Request) => {
        req.socket.destroy();
    });
    app.use((_err: unknown, _req: Request, res: Response, _next: NextFunction) => {
        res.status(500).json({ error: "server error" });
    });
}
