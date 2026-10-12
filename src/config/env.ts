import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

// the installed app keeps its settings in ~/.locksmate, not in the project folder
const dir = join(homedir(), ".locksmate");
const config = join(dir, "config.env");
if (existsSync(config)) process.loadEnvFile(config);
if (!process.env.DATABASE_CA && existsSync(join(dir, "ca.pem"))) process.env.DATABASE_CA = join(dir, "ca.pem");
