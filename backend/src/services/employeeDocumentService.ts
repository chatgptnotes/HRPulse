import fs from 'fs';
import path from 'path';
import multer from 'multer';
import { createHash, randomUUID } from 'crypto';
import { supabase } from '../db/supabase';

const documentDir = path.join(process.cwd(), 'uploads', 'documents');
const indexPath = path.join(documentDir, 'document-index.json');
fs.mkdirSync(documentDir, { recursive: true });

export const employeeDocumentUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (/pdf|image|word|msword|officedocument|plain/i.test(file.mimetype) || /\.(pdf|png|jpe?g|docx?|txt)$/i.test(file.originalname)) {
      cb(null, true);
    } else {
      cb(new Error('Only PDF, image, Word, or text documents are allowed'));
    }
  },
});

export type EmployeeDocumentRow = {
  id: string;
  employee_id: number;
  document_type: string;
  original_filename: string;
  stored_filename: string;
  mime_type: string;
  file_size: number;
  file_path: string;
  source: string;
  uploaded_by: string | null;
  created_at: string;
  public_uuid?: string | null;
  storage_bucket?: string | null;
  storage_path?: string | null;
  sha256?: string | null;
  scan_status?: string | null;
  verification_status?: string | null;
  expiry_date?: string | null;
  version?: number | null;
};

function isMissingRelation(message: string) {
  return /employee_documents|relation .* does not exist|schema cache|does not exist/i.test(message || '');
}

function safeName(value: string) {
  return value.replace(/[^a-zA-Z0-9._-]+/g, '_').replace(/^_+|_+$/g, '') || 'document';
}

function readIndex(): EmployeeDocumentRow[] {
  try {
    return JSON.parse(fs.readFileSync(indexPath, 'utf8'));
  } catch {
    return [];
  }
}

function writeIndex(rows: EmployeeDocumentRow[]) {
  fs.writeFileSync(indexPath, JSON.stringify(rows, null, 2));
}

function toClient(row: EmployeeDocumentRow) {
  return {
    id: row.id,
    employeeId: row.employee_id,
    documentType: row.document_type,
    originalFilename: row.original_filename,
    mimeType: row.mime_type,
    fileSize: row.file_size,
    source: row.source,
    uploadedBy: row.uploaded_by,
    createdAt: row.created_at,
    publicUuid: row.public_uuid || row.id,
    version: Number(row.version || 1),
    sha256: row.sha256 || '',
    scanStatus: row.scan_status || (row.storage_path ? 'quarantined' : 'legacy_local'),
    verificationStatus: row.verification_status || 'pending',
    expiryDate: row.expiry_date || null,
    url: null,
  };
}

export async function saveEmployeeDocument(input: {
  employeeId: number;
  file: Express.Multer.File;
  documentType?: string;
  source?: string;
  uploadedBy?: string | null;
}) {
  const id = randomUUID();
  const original = safeName(input.file.originalname || 'document');
  const stored = `${input.employeeId}-${Date.now()}-${id.slice(0, 8)}-${original}`;
  const storageBucket = 'employee-documents-private';
  const storagePath = `${input.employeeId}/${id}/${stored}`;
  const checksum = createHash('sha256').update(input.file.buffer).digest('hex');
  const uploaded = await supabase.storage
    .from(storageBucket)
    .upload(storagePath, input.file.buffer, {
      contentType: input.file.mimetype || 'application/octet-stream',
      upsert: false,
    });
  if (uploaded.error) throw new Error(`Secure document upload failed: ${uploaded.error.message}`);

  const row: EmployeeDocumentRow = {
    id,
    employee_id: input.employeeId,
    document_type: String(input.documentType || 'General Document').trim() || 'General Document',
    original_filename: input.file.originalname || original,
    stored_filename: stored,
    mime_type: input.file.mimetype || 'application/octet-stream',
    file_size: input.file.size || input.file.buffer.length,
    file_path: storagePath,
    source: input.source || 'hrpulse',
    uploaded_by: input.uploadedBy || null,
    created_at: new Date().toISOString(),
    public_uuid: id,
    storage_bucket: storageBucket,
    storage_path: storagePath,
    sha256: checksum,
    scan_status: 'quarantined',
    verification_status: 'pending',
    version: 1,
  };

  const { data, error } = await supabase
    .from('employee_documents')
    .insert(row)
    .select('*')
    .single();
  if (error) {
    await supabase.storage.from(storageBucket).remove([storagePath]);
    throw new Error(error.message);
  }

  return toClient((data || row) as EmployeeDocumentRow);
}

export async function listEmployeeDocuments(employeeId: number) {
  const { data, error } = await supabase
    .from('employee_documents')
    .select('*')
    .eq('employee_id', employeeId)
    .order('created_at', { ascending: false });

  if (!error) return (data || []).map((row: EmployeeDocumentRow) => toClient(row));
  if (!isMissingRelation(error.message)) throw new Error(error.message);

  return readIndex()
    .filter((row) => row.employee_id === employeeId)
    .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))
    .map(toClient);
}

export async function findEmployeeDocument(employeeId: number, documentId: string) {
  const { data, error } = await supabase
    .from('employee_documents')
    .select('*')
    .eq('employee_id', employeeId)
    .eq('id', documentId)
    .maybeSingle();

  let row: EmployeeDocumentRow | null = null;
  if (!error) row = data as EmployeeDocumentRow | null;
  else if (!isMissingRelation(error.message)) throw new Error(error.message);

  if (!row) row = readIndex().find((item) => item.employee_id === employeeId && item.id === documentId) || null;
  if (!row) return null;

  return {
    row,
    client: toClient(row),
    absolutePath: row.storage_path ? null : path.join(documentDir, row.stored_filename),
  };
}

export async function createEmployeeDocumentSignedUrl(employeeId: number, documentId: string, expiresInSeconds = 300) {
  const document = await findEmployeeDocument(employeeId, documentId);
  if (!document) return null;
  if (!document.row.storage_path || !document.row.storage_bucket) {
    return { ...document, signedUrl: null, legacyLocal: true };
  }
  if (document.row.scan_status !== 'clean') {
    const error = new Error('Document is quarantined until malware scanning passes');
    (error as Error & { code?: string }).code = 'DOCUMENT_QUARANTINED';
    throw error;
  }
  const signed = await supabase.storage
    .from(document.row.storage_bucket)
    .createSignedUrl(document.row.storage_path, expiresInSeconds);
  if (signed.error) throw new Error(signed.error.message);
  return { ...document, signedUrl: signed.data.signedUrl, legacyLocal: false };
}
