import 'dotenv/config';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createPool } from './client';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const migrationDir = path.resolve(__dirname, '../../../db/migrations');

async function migrate(): Promise<void> {
  const pool = createPool();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`
      CREATE TABLE IF NOT EXISTS migrations (
        id TEXT PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);

    const files = (await fs.readdir(migrationDir)).filter((file) => file.endsWith('.sql')).sort();
    for (const file of files) {
      const alreadyApplied = await client.query('SELECT 1 FROM migrations WHERE id = $1', [file]);
      if (alreadyApplied.rowCount && alreadyApplied.rowCount > 0) continue;
      const sql = await fs.readFile(path.join(migrationDir, file), 'utf8');
      await client.query(sql);
      await client.query('INSERT INTO migrations (id) VALUES ($1)', [file]);
      console.log(`Applied ${file}`);
    }

    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

migrate().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
