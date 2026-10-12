import process from "node:process";


export const applicationPORT = 9009

// aiven database
export const databseName = process.env.DATABASE_NAME;
export const databasePassword = process.env.DATABASE_PASSWORD
export const database_Host = process.env.DATABASE_HOST
export const database_port = process.env.DATABASE_PORT
export const database_user = process.env.DATABASE_USER
export const databaseCA = process.env.DATABASE_CA ?? "ca.pem"

// export {databseName, databasePassword, database_Host, database_port, database_user}