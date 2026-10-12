
import { applicationPORT } from "./src/config/configuration.js";
import { app, finishApp } from "./src/core/base.js";

import { StoreData } from "./src/core/dataRet.js";
import { AuthRoutes } from "./src/core/auth.js";
import { DataManager } from "./src/database/data.js";


await new DataManager().createDatabase();

new StoreData();
await new AuthRoutes().init();
finishApp();

// localhost only, the extension is the only client
app.listen(Number(applicationPORT), "127.0.0.1", (err) => {
    if (err) throw err;
    console.log(`listening on ${applicationPORT}`);
});