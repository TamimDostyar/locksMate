import express from "express";
import type { Request, Response } from "express";
import { randomBytes } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import {
    generateAuthenticationOptions, generateRegistrationOptions,
    verifyAuthenticationResponse, verifyRegistrationResponse,
} from "@simplewebauthn/server";
import { app, createSession, endSession, pinOrigin } from "./base.js";
import { DataManager } from "../database/data.js";
import type { KeyMode, Master } from "../database/data.js";
import { PasswordManager } from "../auth/passwordManager.js";

const MAX_FAILS = 5;
const LOCK_MS = 60_000;
const CHALLENGE_MS = 2 * 60_000;
const KEY_FILE = join(homedir(), ".locksmate", "vault.key");

// Chrome uses the whole extension origin as the RP ID, not just the extension id
const rpIdOf = (origin: string) => origin;

export class AuthRoutes {
    private readonly router = express.Router();
    private readonly dataM = new DataManager();
    private readonly passM = new PasswordManager();
    private master: Master | undefined;
    private challenge: { value: string; origin: string; expires: number } | undefined;
    private fails = 0;
    private lockedUntil = 0;

    constructor() {
        this.router.get("/status", (req, res) => this.status(req, res));
        this.router.post("/setup/options", (req, res) => this.setupOptions(req, res));
        this.router.post("/setup/verify", (req, res) => this.setupVerify(req, res));
        this.router.post("/login/options", (req, res) => this.loginOptions(req, res));
        this.router.post("/login", (req, res) => this.login(req, res));
        this.router.post("/logout", (req, res) => {
            endSession(req);
            res.json({ locked: true });
        });
        app.use("/api/auth", this.router);
    }

    async init(): Promise<void> {
        this.master = await this.dataM.readMaster();
        if (this.master) {
            pinOrigin(this.master.origin);
            console.log(`vault locked to ${this.master.origin}`);
        } else {
            console.log("vault not set up yet, open the extension to set it up with Touch ID");
        }
    }

    private status(_req: Request, res: Response): void {
        res.json({ registered: Boolean(this.master) });
    }

    private async setupOptions(req: Request, res: Response): Promise<void> {
        if (this.master) {
            res.status(409).json({ error: "Already set up" });
            return;
        }
        const origin = req.get("origin") ?? "";
        if (!origin.startsWith("chrome-extension://")) {
            res.status(400).json({ error: "Setup must be done from the extension" });
            return;
        }
        const options = await generateRegistrationOptions({
            rpName: "LocksMate",
            rpID: new URL(origin).hostname,
            userName: "locksmate",
            attestationType: "none",
            authenticatorSelection: {
                authenticatorAttachment: "platform",
                userVerification: "required",
                residentKey: "discouraged",
            },
            extensions: { prf: {} } as Record<string, unknown>,
        });
        this.challenge = { value: options.challenge, origin, expires: Date.now() + CHALLENGE_MS };
        res.json(options);
    }

    private async setupVerify(req: Request, res: Response): Promise<void> {
        const challenge = this.takeChallenge();
        if (this.master || !challenge || challenge.origin !== req.get("origin")) {
            res.status(400).json({ error: "Setup expired, try again" });
            return;
        }
        const result = await verifyRegistrationResponse({
            response: req.body?.credential,
            expectedChallenge: challenge.value,
            expectedOrigin: challenge.origin,
            expectedRPID: rpIdOf(challenge.origin),
            requireUserVerification: true,
        }).catch((e: Error) => {
            console.error("touch id setup failed:", e.message);
            return { verified: false as const, reason: e.message };
        });
        if (!result.verified) {
            res.status(400).json({ error: `Touch ID setup failed: ${"reason" in result ? result.reason : "not verified"}` });
            return;
        }

        const { credential } = result.registrationInfo;
        const master: Master = {
            salt: randomBytes(32).toString("base64url"),
            credentialId: credential.id,
            publicKey: Buffer.from(credential.publicKey).toString("base64"),
            counter: credential.counter,
            origin: challenge.origin,
            keyMode: null,
        };
        await this.dataM.saveMaster(master);
        this.master = master;
        pinOrigin(master.origin);
        console.log(`vault set up and locked to ${master.origin}`);
        res.status(201).json({ registered: true });
    }

    private async loginOptions(_req: Request, res: Response): Promise<void> {
        if (!this.master) {
            res.status(400).json({ error: "Not set up" });
            return;
        }
        const options = await generateAuthenticationOptions({
            rpID: new URL(this.master.origin).hostname,
            allowCredentials: [{ id: this.master.credentialId }],
            userVerification: "required",
            // Touch ID returns a secret for this salt, the vault key is derived from it
            extensions: { prf: { eval: { first: this.master.salt } } } as Record<string, unknown>,
        });
        this.challenge = { value: options.challenge, origin: this.master.origin, expires: Date.now() + CHALLENGE_MS };
        res.json(options);
    }

    private async login(req: Request, res: Response): Promise<void> {
        if (Date.now() < this.lockedUntil) {
            res.status(429).json({ error: "Too many attempts, wait a minute" });
            return;
        }
        const { credential, prf } = req.body ?? {};
        const master = this.master;
        const challenge = this.takeChallenge();
        if (!master || !challenge) {
            res.status(400).json({ error: "Unlock expired, try again" });
            return;
        }

        const result = await verifyAuthenticationResponse({
            response: credential,
            expectedChallenge: challenge.value,
            expectedOrigin: master.origin,
            expectedRPID: rpIdOf(master.origin),
            credential: {
                id: master.credentialId,
                publicKey: new Uint8Array(Buffer.from(master.publicKey, "base64")),
                counter: master.counter,
            },
            requireUserVerification: true,
        }).catch((e: Error) => {
            console.error("touch id unlock failed:", e.message);
            return undefined;
        });
        if (!result?.verified) {
            this.fail();
            res.status(401).json({ error: "Touch ID check failed" });
            return;
        }

        const secret = typeof prf === "string" && prf ? Buffer.from(prf, "base64url") : undefined;
        // the first unlock picks where the key comes from, and it never changes after
        if (!master.keyMode) {
            master.keyMode = secret ? "prf" : "file";
            await this.dataM.saveKeyMode(master.keyMode);
            console.log(`vault key from ${master.keyMode === "prf" ? "Touch ID" : KEY_FILE}`);
        }
        if (master.keyMode === "prf" && !secret) {
            res.status(400).json({ error: "Touch ID didn't return the vault key, try again" });
            return;
        }

        this.fails = 0;
        master.counter = result.authenticationInfo.newCounter;
        await this.dataM.saveCounter(master.counter);
        const key = this.passM.deriveKey(this.secretFor(master.keyMode, secret), master.salt);
        res.json({ token: createSession(key) });
    }

    // fallback for Macs whose Touch ID can't return a secret: a key file only this user can read
    private secretFor(mode: KeyMode, prf: Buffer | undefined): Buffer {
        if (mode === "prf" && prf) return prf;
        if (!existsSync(KEY_FILE)) {
            mkdirSync(join(homedir(), ".locksmate"), { recursive: true, mode: 0o700 });
            writeFileSync(KEY_FILE, randomBytes(32), { mode: 0o600 });
        }
        chmodSync(KEY_FILE, 0o600);
        return readFileSync(KEY_FILE);
    }

    private takeChallenge() {
        const challenge = this.challenge;
        this.challenge = undefined;
        return challenge && challenge.expires > Date.now() ? challenge : undefined;
    }

    private fail(): void {
        if (++this.fails >= MAX_FAILS) {
            this.fails = 0;
            this.lockedUntil = Date.now() + LOCK_MS;
        }
    }
}
