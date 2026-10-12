import generator from 'generate-password';
import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from 'node:crypto';


export class PasswordManager{

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

    // vault key from a secret only Touch ID can produce, so the database alone can't be decrypted
    deriveKey(secret: Buffer, salt: string): Buffer {
        return Buffer.from(hkdfSync('sha256', secret, salt, 'locksmate vault key', 32));
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
