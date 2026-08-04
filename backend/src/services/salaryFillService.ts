import xlsx from 'xlsx';

function norm(s: unknown): string {
  return String(s || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ');
}

function levenshtein(a: string, b: string): number {
  const m = a.length, n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = a[i - 1] === b[j - 1] ? dp[i - 1][j - 1] : 1 + Math.min(dp[i - 1][j - 1], dp[i][j - 1], dp[i - 1][j]);
    }
  }
  return dp[m][n];
}

function phoneticScore(a: string, b: string): number {
  if (a === b) return 1;
  const dist = levenshtein(a, b);
  const maxLen = Math.max(a.length, b.length);
  return 1 - dist / maxLen;
}

interface AttendanceEntry { name: string; daysWorked: number; }

export interface FillResult {
  filled: number;
  notFound: number;
  phoneticMatches: Array<{ salaryName: string; attendanceName: string; method: string; score: number; days: number }>;
  matchedNames: string[];
  unmatchedNames: string[];
  buffer: Buffer;
}

export function fillSalarySheet(
  salaryBuffer: Buffer,
  attendanceBuffer: Buffer,
  sheetName: string,
  workingDays: number,
): FillResult {
  // ── Parse attendance file ────────────────────────────────────────────────
  const attWb = xlsx.read(attendanceBuffer, { type: 'buffer' });
  const attWs = attWb.Sheets[attWb.SheetNames[0]];
  const attRows = xlsx.utils.sheet_to_json(attWs, { header: 1 }) as any[][];

  const attendanceByNormName = new Map<string, AttendanceEntry>();
  for (let i = 4; i < attRows.length; i++) {
    const row = attRows[i];
    const name = row && row[1] ? String(row[1]).trim() : '';
    if (!name || name.length < 3 || /^[\d\s\n:]+$/.test(name)) continue;
    let daysWorked = 0;
    for (let day = 1; day <= 31; day++) {
      const cv = row[day + 1];
      if (cv != null && String(cv).trim() !== '' && (/\d{2}:\d{2}/.test(String(cv)) || String(cv).length > 0)) daysWorked++;
    }
    const nk = norm(name);
    if (!attendanceByNormName.has(nk) || attendanceByNormName.get(nk)!.daysWorked < daysWorked) {
      attendanceByNormName.set(nk, { name, daysWorked });
    }
  }

  // ── Parse salary sheet ───────────────────────────────────────────────────
  const salWb = xlsx.read(salaryBuffer, { type: 'buffer', cellStyles: true });
  const ws = salWb.Sheets[sheetName];
  if (!ws) throw new Error(`Sheet "${sheetName}" not found. Available: ${salWb.SheetNames.join(', ')}`);
  const range = xlsx.utils.decode_range(ws['!ref'] || 'A1:I1');

  const HEADER_ROW = 1;
  const COL_NAME = 1, COL_DAYS = 4, COL_PAYMENT = 5, COL_PAYABLE = 7;

  let filled = 0, notFound = 0;
  const phoneticMatches: FillResult['phoneticMatches'] = [];
  const matchedNames: string[] = [];
  const unmatchedNames: string[] = [];

  for (let r = HEADER_ROW + 1; r <= range.e.r; r++) {
    const nameCell = ws[xlsx.utils.encode_cell({ r, c: COL_NAME })];
    if (!nameCell || !nameCell.v) continue;
    const sheetNameVal = String(nameCell.v).trim();
    if (!sheetNameVal || sheetNameVal.length < 2) continue;
    const snNorm = norm(sheetNameVal);

    // Find attendance
    let attData: AttendanceEntry | null = null;
    let method = 'NONE';
    let score = 0;

    // 1. Exact
    if (attendanceByNormName.has(snNorm)) {
      attData = attendanceByNormName.get(snNorm)!;
      method = 'EXACT'; score = 1;
    }

    // 2. Substring
    if (!attData) {
      for (const [attN, att] of attendanceByNormName) {
        if (snNorm.length >= 4 && (attN.includes(snNorm) || snNorm.includes(attN))) {
          attData = att; method = 'SUBSTRING'; score = 0.9; break;
        }
      }
    }

    // 3. Phonetic
    if (!attData) {
      const snFirst = snNorm.split(' ')[0];
      let bestScore = 0;
      for (const [attN, att] of attendanceByNormName) {
        const attFirst = attN.split(' ')[0];
        if (snFirst.length >= 4 && attFirst.length >= 4) {
          const fs = phoneticScore(snFirst, attFirst);
          if (fs >= 0.75) {
            const combined = fs * 0.6 + phoneticScore(snNorm, attN) * 0.4;
            if (combined >= 0.6 && combined > bestScore) {
              attData = att; method = 'PHONETIC'; score = combined; bestScore = combined;
            }
          }
        }
        if (snNorm.length >= 5) {
          const fs = phoneticScore(snNorm, attN);
          if (fs >= 0.8 && fs > bestScore) {
            attData = att; method = 'CLOSE'; score = fs; bestScore = fs;
          }
        }
      }
    }

    if (attData && attData.daysWorked > 0) {
      const days = attData.daysWorked;
      const excelRow = r + 1;
      ws[xlsx.utils.encode_cell({ r, c: COL_DAYS })] = { t: 'n', v: days };
      ws[xlsx.utils.encode_cell({ r, c: COL_PAYMENT })] = { t: 'n', f: `D${excelRow}/${workingDays}*E${excelRow}` };
      ws[xlsx.utils.encode_cell({ r, c: COL_PAYABLE })] = { t: 'n', f: `F${excelRow}-G${excelRow}` };
      filled++;
      matchedNames.push(sheetNameVal);
      if (method === 'PHONETIC' || method === 'CLOSE') {
        phoneticMatches.push({ salaryName: sheetNameVal, attendanceName: attData.name, method, score: Math.round(score * 100) / 100, days });
      }
    } else {
      notFound++;
      unmatchedNames.push(sheetNameVal);
    }
  }

  // Write output buffer
  const outBuffer = xlsx.write(salWb, { type: 'buffer', bookType: 'xlsx' });

  return { filled, notFound, phoneticMatches, matchedNames, unmatchedNames, buffer: outBuffer };
}