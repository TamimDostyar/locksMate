import "./src/config/env.js";
import { app, finishApp } from "./src/core/base.js";
import { StoreData } from "./src/core/dataRet.js";
import { AuthRoutes } from "./src/core/auth.js";
import { DataManager } from "./src/database/data.js";
import { logToFile, startNativeHost } from "./src/core/native.js";

async function main(): Promise<void> {
    logToFile();
    await new DataManager().createDatabase();

    new StoreData();
    await new AuthRoutes().init();
    finishApp();

    startNativeHost(app);
}

main().catch((e: Error) => {
    console.error("backend failed to start:", e.message);
    process.exit(1);
});
