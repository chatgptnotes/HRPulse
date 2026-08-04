import { Router } from 'express';
import { createClient } from '@supabase/supabase-js';

const router = Router();

// HIMS Supabase credentials
const HIMS_URL = 'https://xvkxccqaopbnkvwgyfjv.supabase.co';
const HIMS_KEY = process.env.HIMS_SERVICE_ROLE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inh2a3hjY3Fhb3Bibmt2d2d5Zmp2Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc0NzgyMzAxMiwiZXhwIjoyMDYzMzk5MDEyfQ.priN_SHguFTwZu47KUwtUNzN5jkmNFDGgAQy4rvdMXw';

// POST /api/salary-fill/sync-hims
// Accepts: entries array with salary data, month
// Pushes to HIMS hr_payroll_slips table
router.post('/sync-hims', async (req, res) => {
  try {
    const { entries, month } = req.body;
    if (!entries || !Array.isArray(entries) || entries.length === 0) {
      res.status(400).json({ error: 'No entries provided' });
      return;
    }

    const hims = createClient(HIMS_URL, HIMS_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    // Step 1: Delete old hrpulse entries for this month
    const payrollMonth = month ? `${month}-01` : new Date().toISOString().slice(0, 7) + '-01';
    const { error: delErr } = await hims
      .from('hr_payroll_slips')
      .delete()
      .eq('entry_source', 'hrpulse')
      .eq('payroll_month', payrollMonth);

    if (delErr) {
      console.error('[sync-hims] Delete error:', delErr.message);
    }

    // Step 2: Build records — skip 0-attendance
    const records = entries
      .filter((e: any) => e.daysPresent > 0)
      .map((e: any) => ({
        employee_name: e.employeeName,
        payroll_month: payrollMonth,
        designation: e.designation || null,
        base_monthly_salary: e.monthlySalary,
        days_present: e.daysPresent,
        duty_count: e.otDuties || 0,
        gross_salary: e.grossSalary,
        deductions: e.deductions,
        net_salary: Math.max(0, e.netSalary),
        entry_source: 'hrpulse',
      }));

    // Step 3: Insert in batches
    let inserted = 0;
    let errors = 0;
    for (let i = 0; i < records.length; i += 25) {
      const batch = records.slice(i, i + 25);
      const { error } = await hims.from('hr_payroll_slips').insert(batch);
      if (error) {
        console.error('[sync-hims] Insert error:', error.message);
        errors += batch.length;
      } else {
        inserted += batch.length;
      }
    }

    const skipped = entries.filter((e: any) => e.daysPresent === 0).map((e: any) => e.employeeName);

    res.json({
      success: true,
      inserted,
      errors,
      skipped: skipped.length,
      skippedNames: skipped,
      total: entries.length,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[sync-hims]', message);
    res.status(500).json({ error: message });
  }
});

export default router;