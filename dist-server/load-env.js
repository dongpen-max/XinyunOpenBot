// Load environment variables from .env.local before starting the app
// This file is imported by server/index.ts
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
const envPath = resolve(process.cwd(), '.env.local');
if (existsSync(envPath)) {
    const envContent = readFileSync(envPath, 'utf-8');
    envContent.split('\n').forEach(line => {
        const trimmed = line.trim();
        // Skip comments and empty lines
        if (!trimmed || trimmed.startsWith('#')) {
            return;
        }
        // Parse KEY=VALUE
        const match = trimmed.match(/^([^=]+)=(.*)$/);
        if (match) {
            const [, key, value] = match;
            const cleanKey = key.trim();
            const cleanValue = value.trim();
            // Only set if not already defined
            if (!process.env[cleanKey]) {
                process.env[cleanKey] = cleanValue;
            }
        }
    });
    console.log('[.env.local] Environment variables loaded');
}
