import { Router } from 'express';
import multer from 'multer';
import { fillSalarySheet } from '../services/salaryFillService';

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });

// POST /api/salary-fill
// Accepts: salarySheet (xlsx), attendanceFile (xls), sheetName, workingDays
// Returns: JSON summary + downloadable xlsx as base64
router.post('/', upload.fields([
  { name: 'salarySheet', maxCount: 1 },
  { name: 'attendanceFile', maxCount: 1 },
]), async (req, res) => {
  try {
    const files = req.files as { salarySheet?: Express.Multer.File[]; attendanceFile?: Express.Multer.File[] };
    if (!files?.salarySheet?.[0] || !files?.attendanceFile?.[0]) {
      res.status(400).json({ error: 'Both salarySheet and attendanceFile are required' });
      return;
    }

    const sheetName = (req.body.sheetName || 'july-26').trim();
    const workingDays = Number(req.body.workingDays) || 26;

    const result = fillSalarySheet(
      files.salarySheet[0].buffer,
      files.attendanceFile[0].buffer,
      sheetName,
      workingDays,
    );

    res.json({
      filled: result.filled,
      notFound: result.notFound,
      phoneticMatches: result.phoneticMatches,
      matchedNames: result.matchedNames,
      unmatchedNames: result.unmatchedNames,
      fileBase64: result.buffer.toString('base64'),
      fileName: `Salary-${sheetName}-FILLED.xlsx`,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[salary-fill]', message);
    res.status(500).json({ error: message });
  }
});

export default router;