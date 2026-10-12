import { database_Host, databasePassword, databseName,
    database_port, database_user, databaseCA
} from "../config/configuration.js";

import { readFileSync } from "node:fs";

import pg from "pg";

export type KeyMode = "prf" | "file";

export type Master = {
    salt: string;
    credentialId: string;
    publicKey: string;
    counter: number;
    origin: string;
    keyMode: KeyMode | null;
};

const config = {
    user: database_user,
    password: databasePassword,
    host: database_Host,
    port: Number(database_port),
    database: databseName,
    ssl: { ca: readFileSync(databaseCA, "utf8") },
};

// one pool for the whole host: a fresh TLS connection per query made every click slow
const pool = new pg.Pool({ ...config, max: 5, idleTimeoutMillis: 5 * 60_000, connectionTimeoutMillis: 10_000 });
pool.on("error", (e) => console.error("database connection dropped:", e.message));

export class DataManager {
    private readonly createTable = `CREATE TABLE IF NOT EXISTS locks_mate (url TEXT, email TEXT, password TEXT)`;
    private readonly upgradeTable = `ALTER TABLE locks_mate
        ADD COLUMN IF NOT EXISTS id SERIAL,
        ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT now()`;
    private readonly insertData = `INSERT INTO locks_mate (url, email, password) VALUES ($1, $2, $3)`;
    private readonly updateData = `UPDATE locks_mate SET password = $3, updated_at = now() WHERE url = $1 AND email = $2`;
    private readonly latestEmail = `SELECT email FROM locks_mate ORDER BY updated_at DESC NULLS LAST LIMIT 1`;
    private readonly readData = `SELECT * FROM locks_mate WHERE url = $1`;
    private readonly readAll = `SELECT * FROM locks_mate ORDER BY url`;
    private readonly deleteData = `DELETE FROM locks_mate WHERE id = $1`;
    private readonly createMasterTable = `CREATE TABLE IF NOT EXISTS locks_master (hash TEXT)`;
    private readonly upgradeMasterTable = `ALTER TABLE locks_master
        ADD COLUMN IF NOT EXISTS salt TEXT,
        ADD COLUMN IF NOT EXISTS credential_id TEXT,
        ADD COLUMN IF NOT EXISTS public_key TEXT,
        ADD COLUMN IF NOT EXISTS counter BIGINT,
        ADD COLUMN IF NOT EXISTS origin TEXT,
        ADD COLUMN IF NOT EXISTS key_mode TEXT`;
    private readonly insertMaster = `INSERT INTO locks_master (salt, credential_id, public_key, counter, origin) VALUES ($1, $2, $3, $4, $5)`;
    private readonly selectMaster = `SELECT salt, credential_id, public_key, counter, origin, key_mode FROM locks_master LIMIT 1`;
    private readonly updateCounter = `UPDATE locks_master SET counter = $1`;
    private readonly updateKeyMode = `UPDATE locks_master SET key_mode = $1`;

    async checkDBStatus(): Promise<boolean> {
        try {
            await pool.query("SELECT VERSION()");
            return true;
        } catch {
            return false;
        }
    }

    async createDatabase(): Promise<void> {
        if (!(await this.checkDBStatus())) {
            throw new Error("database unreachable");
        }
        await this.run(this.createTable);
        await this.run(this.upgradeTable);
        await this.run(this.createMasterTable);
        await this.run(this.upgradeMasterTable);
    }

    async insertIntoTable(url:string, email:string, password:string): Promise<void> {
        const updated = await this.run(this.updateData, [url, email, password]);
        if (updated.rowCount === 0) {
            await this.run(this.insertData, [url, email, password]);
        }
    }


    // no url returns every entry
    async readFromTable(url?: string): Promise<{ id: number; url: string; email: string; password: string }[]> {
        const result = url === undefined
            ? await this.run(this.readAll)
            : await this.run(this.readData, [url]);
        return result.rows;
    }

    async deleteEntry(id: number): Promise<void> {
        await this.run(this.deleteData, [id]);
    }

    async readLatestEmail(): Promise<string | undefined> {
        return (await this.run(this.latestEmail)).rows[0]?.email;
    }

    async saveMaster(m: Master): Promise<void> {
        await this.run(this.insertMaster, [m.salt, m.credentialId, m.publicKey, m.counter, m.origin]);
    }

    async readMaster(): Promise<Master | undefined> {
        const row = (await this.run(this.selectMaster)).rows[0];
        if (!row?.credential_id) return undefined;
        return {
            salt: row.salt,
            credentialId: row.credential_id,
            publicKey: row.public_key,
            counter: Number(row.counter),
            origin: row.origin,
            keyMode: row.key_mode,
        };
    }

    async saveKeyMode(mode: KeyMode): Promise<void> {
        await this.run(this.updateKeyMode, [mode]);
    }

    async saveCounter(counter: number): Promise<void> {
        await this.run(this.updateCounter, [counter]);
    }

    private run(query: string, values: unknown[] = []) {
        return pool.query(query, values);
    }
}
