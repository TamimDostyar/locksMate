import inject from "light-my-request";
import type { Express } from "express";
import { appendFileSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

type NativeRequest = { id: number; method: string; path: string; body?: unknown; token?: string };

export function logToFile(): void {
    const dir = join(homedir(), ".locksmate");
    mkdirSync(dir, { recursive: true, mode: 0o700 });

    const logFile = join(dir, "host.log");
    const write = (...args: unknown[]) =>
        appendFileSync(logFile, new Date().toISOString() + " " + args.map(String).join(" ") + "\n", { mode: 0o600 });

    console.log = write;
    console.error = write;
}

function send(message: unknown): void {
    const payload = Buffer.from(JSON.stringify(message));
    const lengthPrefix = Buffer.alloc(4);
    lengthPrefix.writeUInt32LE(payload.length);

    process.stdout.write(Buffer.concat([lengthPrefix, payload]));
}

export function startNativeHost(app: Express): void {
    const origin = (process.argv[2] ?? "").replace(/\/$/, "");

    async function handleRequest(req: NativeRequest): Promise<void> {
        try {
            const res: inject.Response = await inject(app as unknown as inject.DispatchFunc, {
                method: req.method as NonNullable<inject.InjectOptions["method"]>,
                url: req.path,
                headers: {
                    origin,
                    "content-type": "application/json",
                    ...(req.token ? { authorization: "Bearer " + req.token } : {}),
                },
                ...(req.body === undefined ? {} : { payload: JSON.stringify(req.body) }),
            });

            let body: unknown = {};
            try {
                body = res.json();
            } catch {
                // Some routes return an empty body; keep the status and ignore the parse error.
            }

            send({ id: req.id, status: res.statusCode, body });
        } catch (error) {
            console.error("request failed:", (error as Error).message);
            send({ id: req.id, status: 500, body: { error: "server error" } });
        }
    }

    let buffer = Buffer.alloc(0);

    process.stdin.on("data", (chunk: Buffer) => {
        buffer = Buffer.concat([buffer, chunk]);

        while (buffer.length >= 4) {
            const frameLength = buffer.readUInt32LE(0);
            const totalLength = 4 + frameLength;

            if (buffer.length < totalLength) {
                break;
            }

            const message = JSON.parse(buffer.subarray(4, totalLength).toString("utf8")) as NativeRequest;
            buffer = buffer.subarray(totalLength);
            void handleRequest(message);
        }
    });

    process.stdin.on("end", () => process.exit(0));
}
