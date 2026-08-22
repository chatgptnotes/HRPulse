-- Link the local salary-ledger cache to Adamrit chart_of_accounts records.
ALTER TABLE public.salary_ledgers
  ADD COLUMN IF NOT EXISTS adamrit_account_id UUID;

CREATE UNIQUE INDEX IF NOT EXISTS salary_ledgers_adamrit_account_id_key
  ON public.salary_ledgers (adamrit_account_id)
  WHERE adamrit_account_id IS NOT NULL;

DROP POLICY IF EXISTS salary_ledgers_authenticated_write ON public.salary_ledgers;
CREATE POLICY salary_ledgers_authenticated_write
  ON public.salary_ledgers FOR ALL TO authenticated USING (true) WITH CHECK (true);
