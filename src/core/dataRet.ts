import express from "express";
import type { Request, Response } from "express";
import { app, requireAuth } from "./base.js";
import { DataManager } from "../database/data.js";
import { PasswordManager } from "../auth/passwordManager.js";

export class StoreData {
    private readonly router = express.Router();
    private readonly dataM = new DataManager();
    private readonly passM = new PasswordManager();

    constructor() {
        this.router.use(requireAuth);
        this.router.get("/", (req, res) => this.readDataFromDB(req, res));
        this.router.post("/", (req, res) => this.addNewData(req, res));
        this.router.get("/email", (req, res) => this.latestEmail(req, res));
        this.router.post("/generate", (req, res) => this.generatePassword(req, res));
        this.router.delete("/:id", (req, res) => this.deleteData(req, res));
        app.use("/api/entries", this.router);
    }

    private async readDataFromDB(req: Request, res: Response): Promise<void> {
        const url = typeof req.query.url === "string" ? req.query.url : undefined;
        const rows = await this.dataM.readFromTable(url);
        res.json({ output: rows.map((row) => ({ ...row, password: this.passM.decrypt(row.password, res.locals.key) })) });
    }

    private async addNewData(req: Request, res: Response): Promise<void> {
        const { url, email, password } = req.body;
        if (![url, email, password].every((v) => typeof v === "string")) {
            res.status(400).json({ error: "url, email, password must be strings" });
            return;
        }
        const encrypted = this.passM.encrypt(password, res.locals.key);
        await this.dataM.insertIntoTable(url, email, encrypted);
        res.status(201).json({ saved: true });
    }

    // last email used, so new sign ups can reuse it
    private async deleteData(req: Request, res: Response): Promise<void> {
        const id = Number(req.params.id);
        if (!Number.isInteger(id)) {
            res.status(400).json({ error: "bad id" });
            return;
        }
        await this.dataM.deleteEntry(id);
        res.json({ deleted: true });
    }

    private async latestEmail(_req: Request, res: Response): Promise<void> {
        res.json({ email: (await this.dataM.readLatestEmail()) ?? "" });
    }

    private async generatePassword(req: Request, res: Response): Promise<void> {
        const { length, number, symbols } = req.body;
        const password = await this.passM.generatePassword(length, number, symbols);
        res.json({ password });
    }
}