import * as argon2 from 'argon2';
import generator from 'generate-password';
import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto';


export class PasswordManager{

    async hashPassword(password: string): Promise<string>{
        return argon2.hash(password);
    }

    async isVerified(storedHash:string, confirmPassword: string): Promise<boolean>{
        try {

            const result = await argon2.verify(storedHash, confirmPassword);
            return result;
        }catch {
            console.log("something went wrong");
            return false;
        }
    }


    async generatePassword(length: number = 10, wNumber: boolean = true, symbols: boolean = true):Promise<string>{
        try {
            const generatePassword = generator.generate({
                length: length,
                symbols: symbols,
                numbers: wNumber,
                strict: true

            })
            return generatePassword;

        } catch {
            return "could not generate password";
        }
    }

    // vault key comes from the master password, so the database alone can't be decrypted
    deriveKey(masterPassword: string, salt: string): Buffer {
        return scryptSync(masterPassword, salt, 32);
    }

    // stored as iv:tag:data (hex)
    encrypt(text: string, key: Buffer): string {
        const iv = randomBytes(12);
        const cipher = createCipheriv('aes-256-gcm', key, iv);
        const data = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
        return [iv, cipher.getAuthTag(), data].map((b) => b.toString('hex')).join(':');
    }

    decrypt(stored: string, key: Buffer): string {
        const [iv, tag, data] = stored.split(':').map((h) => Buffer.from(h, 'hex'));
        if (!iv || !tag || !data) throw new Error("invalid encrypted value");
        const decipher = createDecipheriv('aes-256-gcm', key, iv);
        decipher.setAuthTag(tag);
        return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
    }
}
