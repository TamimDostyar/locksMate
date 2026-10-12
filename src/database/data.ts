import { database_Host, databseName,
    database_port, database_user
 } from "../config/configuration.js";


import pg from 'pg'

export class DataManager{


    private readonly createTable: string = ``;
    private readonly insertData: string = ``;
    private readonly readData: string = ``;

    private readonly config = {
        user: database_user,
        
    }

    constructor(){}


    checkDBStatus(): boolean{



        return false;
    }
    private createDatabase(){
    }
}