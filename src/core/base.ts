import express from "express";
import type { Express, NextFunction, Request, Response } from "express";
import { randomBytes } from "node:crypto";

export const app: Express = express();
app.disable("x-powered-by");

let pinnedOrigin: string | undefined;
export function pinOrigin(origin: string): void {
    pinnedOrigin = origin;
}


// Chrome tells the native host which extension started it, only ours (pinned at setup) is served
app.use((req, res, next) => {
    const origin = req.get("origin") ?? "";
    const ok = pinnedOrigin ? origin === pinnedOrigin : origin.startsWith("chrome-extension://");
    if (!ok) {
        res.status(403).json({ error: "forbidden" });
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
    app.use((_req: Request, res: Response) => {
        res.status(404).json({ error: "not found" });
    });
    app.use((_err: unknown, _req: Request, res: Response, _next: NextFunction) => {
        res.status(500).json({ error: "server error" });
    });
}
