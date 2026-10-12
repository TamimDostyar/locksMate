import express from "express";
import type { Request, Response } from "express";
import { randomBytes, randomInt } from "node:crypto";
import {
    generateAuthenticationOptions, generateRegistrationOptions,
    verifyAuthenticationResponse, verifyRegistrationResponse,
} from "@simplewebauthn/server";
import { app, createSession, endSession, pinOrigin } from "./base.js";
import { DataManager } from "../database/data.js";
import type { Master } from "../database/data.js";
import { PasswordManager } from "../auth/passwordManager.js";

const MAX_FAILS = 5;
const LOCK_MS = 60_000;
const CHALLENGE_MS = 2 * 60_000;

// unlocking needs all three: this extension (origin), Touch ID on this Mac, and the master password
export class AuthRoutes {
    private readonly router = express.Router();
    private readonly dataM = new DataManager();
    private readonly passM = new PasswordManager();
    private master: Master | undefined;
    private setupCode: string | undefined;
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
            return;
        }
        // shown only in this terminal, so only someone at this machine can set up the vault
        this.setupCode = `${randomInt(1000, 10000)}-${randomInt(1000, 10000)}`;
        console.log(`setup code: ${this.setupCode}`);
    }

    private status(_req: Request, res: Response): void {
        res.json({ registered: Boolean(this.master) });
    }

    private async setupOptions(req: Request, res: Response): Promise<void> {
        if (!this.checkSetupCode(req, res)) return;
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
        });
        this.challenge = { value: options.challenge, origin, expires: Date.now() + CHALLENGE_MS };
        res.json(options);
    }

    private async setupVerify(req: Request, res: Response): Promise<void> {
        if (!this.checkSetupCode(req, res)) return;
        const { password, credential } = req.body;
        if (typeof password !== "string" || password.length < 8) {
            res.status(400).json({ error: "Master password must be at least 8 characters" });
            return;
        }
        const challenge = this.takeChallenge();
        if (!challenge || challenge.origin !== req.get("origin")) {
            res.status(400).json({ error: "Setup expired, try again" });
            return;
        }
        const result = await verifyRegistrationResponse({
            response: credential,
            expectedChallenge: challenge.value,
            expectedOrigin: challenge.origin,
            expectedRPID: new URL(challenge.origin).hostname,
            requireUserVerification: true,
        }).catch((e: Error) => {
            console.error("touch id setup failed:", e.message);
            return { verified: false as const, reason: e.message };
        });
        if (!result.verified) {
            res.status(400).json({ error: `Fingerprint check failed: ${"reason" in result ? result.reason : "not verified"}` });
            return;
        }

        const { credential: cred } = result.registrationInfo;
        const salt = randomBytes(16).toString("hex");
        const master: Master = {
            hash: await this.passM.hashPassword(password),
            salt,
            credentialId: cred.id,
            publicKey: Buffer.from(cred.publicKey).toString("base64"),
            counter: cred.counter,
            origin: challenge.origin,
        };
        await this.dataM.saveMaster(master);
        this.master = master;
        this.setupCode = undefined;
        pinOrigin(master.origin);
        res.status(201).json({ token: createSession(this.passM.deriveKey(password, salt)) });
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
        });
        this.challenge = { value: options.challenge, origin: this.master.origin, expires: Date.now() + CHALLENGE_MS };
        res.json(options);
    }

    private async login(req: Request, res: Response): Promise<void> {
        if (Date.now() < this.lockedUntil) {
            res.status(429).json({ error: "Too many attempts, wait a minute" });
            return;
        }
        const { password, credential } = req.body;
        const master = this.master;
        const challenge = this.takeChallenge();
        if (!master || !challenge || typeof password !== "string") {
            res.status(400).json({ error: "Login expired, try again" });
            return;
        }

        const result = await verifyAuthenticationResponse({
            response: credential,
            expectedChallenge: challenge.value,
            expectedOrigin: master.origin,
            expectedRPID: new URL(master.origin).hostname,
            credential: {
                id: master.credentialId,
                publicKey: new Uint8Array(Buffer.from(master.publicKey, "base64")),
                counter: master.counter,
            },
            requireUserVerification: true,
        }).catch((e: Error) => {
            // logged here only, the client just hears "wrong password or fingerprint"
            console.error("touch id login failed:", e.message);
            return undefined;
        });

        if (!result?.verified || !(await this.passM.isVerified(master.hash, password))) {
            this.fail();
            res.status(401).json({ error: "Wrong password or fingerprint" });
            return;
        }

        this.fails = 0;
        master.counter = result.authenticationInfo.newCounter;
        await this.dataM.saveCounter(master.counter);
        res.json({ token: createSession(this.passM.deriveKey(password, master.salt)) });
    }

    private checkSetupCode(req: Request, res: Response): boolean {
        if (Date.now() < this.lockedUntil) {
            res.status(429).json({ error: "Too many attempts, wait a minute" });
            return false;
        }
        if (!this.setupCode || req.body?.code !== this.setupCode) {
            this.fail();
            res.status(401).json({ error: "Wrong setup code" });
            return false;
        }
        return true;
    }

    // challenges are single use
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
