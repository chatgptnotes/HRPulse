-- IT staff receive Sunday weekly offs. Their extra two paid leaves must be
-- expressly enabled from Employee Master, rather than being granted by default.
ALTER TABLE public.employees
  ALTER COLUMN eligible_for_paid_leaves SET DEFAULT FALSE;

-- Existing IT records were created before the Yes/No control existed, when the
-- column default was TRUE. Start them as No so HR can deliberately select only
-- the IT employees who should receive the extra two paid leaves.
UPDATE public.employees
SET eligible_for_paid_leaves = FALSE
WHERE CONCAT_WS(' ', department, organisation, entity) ~* '(^|[^a-z])it([^a-z]|$)|information technology';
