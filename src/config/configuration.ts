import process from "node:process";


// aiven database
const databseName = process.env.DATABASE_NAME;
const databasePassword = process.env.DATABASE_PASSWORD
const database_Host = process.env.DATABASE_HOST
const database_port = process.env.PORT
const database_user = process.env.USER

export {databseName, database_Host, database_port, database_user}