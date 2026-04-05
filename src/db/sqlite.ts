import Database from 'better-sqlite3';
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';

const dbPath = path.join(os.homedir(), '.converge', 'converge.db');
fs.mkdirSync(path.dirname(dbPath), { recursive: true });

export const db: Database.Database = new Database(dbPath);

// Enable WAL mode for better concurrency
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
