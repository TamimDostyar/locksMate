import { database_Host, databasePassword, databseName,
    database_port, database_user
} from "../config/configuration.js";

import pg from "pg";

export class DataManager {
    private readonly createTable = `CREATE TABLE IF NOT EXISTS locks_mate (url TEXT, email TEXT, password TEXT)`;
    private readonly insertData = `INSERT INTO locks_mate (url, email, password) VALUES ($1, $2, $3)`;
    private readonly readData = `SELECT * FROM locks_mate WHERE url = $1`;

    private readonly config = {
        user: database_user,
        password: databasePassword,
        host: database_Host,
        port: Number(database_port),
        database: databseName,
    };

    async checkDBStatus(): Promise<boolean> {
        const client = new pg.Client(this.config);
        try {
            await client.connect();
            await client.query("SELECT VERSION()");
            return true;
        } catch {
            return false;
        } finally {
            await client.end().catch(() => {});
        }
    }

    async createDatabase(): Promise<void> {
        if (!(await this.checkDBStatus())) {
            throw new Error("database unreachable");
        }
        const client = new pg.Client(this.config);
        try {
            await client.connect();
            await client.query(this.createTable);
        } finally {
            await client.end();
        }
    }

    async insertIntoTable(url:string, email:string, password:string): Promise<void> {
        if (!(await this.checkDBStatus())) {
            throw new Error("database unreachable");
        }
        const client = new pg.Client(this.config);
        try {
            await client.connect();
            await client.query(this.insertData, [url, email, password]);
        } finally {
            await client.end();
        }
    }


    async readFromTable(url: string): Promise<{ url: string; email: string; password: string }[]> {
        if (!(await this.checkDBStatus())) {
            throw new Error("database unreachable");
        }
        const client = new pg.Client(this.config);
        try {
            await client.connect();
            const result = await client.query(this.readData, [url]);
            return result.rows;
        } finally {
            await client.end();
        }
    }
}