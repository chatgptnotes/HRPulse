import 'dotenv/config';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const documentDir = path.join(repoRoot, 'uploads', 'documents');
const indexPath = path.join(documentDir, 'document-index.json');
const bucket = 'employee-documents-private';
const supabase = createClient(
  process.env.SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || '',
  { auth: { persistSession: false, autoRefreshToken: false } },
);

const dryRun = !process.argv.includes('--apply');
const index = JSON.parse(await fs.readFile(indexPath, 'utf8'));
let migrated = 0;
let skipped = 0;
let failed = 0;

for (const document of index) {
  try {
    const existing = await supabase
      .from('employee_documents')
      .select('id, storage_path')
      .eq('id', document.id)
      .maybeSingle();
    if (existing.data?.storage_path) {
      skipped++;
      continue;
    }
    const bytes = await fs.readFile(path.join(documentDir, document.stored_filename));
    const checksum = createHash('sha256').update(bytes).digest('hex');
    const storagePath = `legacy/${document.employee_id}/${document.id}/${document.stored_filename}`;
    if (dryRun) {
      console.log(`[dry-run] ${document.original_filename} -> ${storagePath}`);
      migrated++;
      continue;
    }
    const upload = await supabase.storage.from(bucket).upload(storagePath, bytes, {
      contentType: document.mime_type || 'application/octet-stream',
      upsert: false,
    });
    if (upload.error && !/already exists|duplicate/i.test(upload.error.message)) throw upload.error;
    const saved = await supabase.from('employee_documents').upsert({
      ...document,
      public_uuid: document.id,
      storage_bucket: bucket,
      storage_path: storagePath,
      file_path: storagePath,
      sha256: checksum,
      scan_status: 'quarantined',
      verification_status: 'pending',
      version: 1,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'id' });
    if (saved.error) throw saved.error;
    migrated++;
  } catch (error) {
    failed++;
    console.error(`[failed] ${document.original_filename}: ${error instanceof Error ? error.message : error}`);
  }
}

console.log(JSON.stringify({ dryRun, migrated, skipped, failed, localFilesDeleted: false }, null, 2));
if (failed) process.exitCode = 1;
