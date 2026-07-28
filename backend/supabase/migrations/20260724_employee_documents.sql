CREATE TABLE IF NOT EXISTS employee_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id integer NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  document_type text NOT NULL DEFAULT 'General Document',
  original_filename text NOT NULL,
  stored_filename text NOT NULL,
  mime_type text NOT NULL DEFAULT 'application/octet-stream',
  file_size integer NOT NULL DEFAULT 0,
  file_path text NOT NULL,
  source text NOT NULL DEFAULT 'hrpulse',
  uploaded_by text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS employee_documents_employee_created_idx
  ON employee_documents (employee_id, created_at DESC);

ALTER TABLE employee_documents ENABLE ROW LEVEL SECURITY;

NOTIFY pgrst, 'reload schema';
