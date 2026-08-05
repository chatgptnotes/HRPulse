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

export function getMonthInfo(monthStr: string) {
  const [year, month] = monthStr.split('-').map(Number);
  const daysInMonth = new Date(year, month, 0).getDate();
  let sundays = 0;
  for (let d = 1; d <= daysInMonth; d++) {
    if (new Date(year, month - 1, d).getDay() === 0) sundays++;
  }
  return {
    daysInMonth,
    sundays,
    hospitalWD: daysInMonth - 4,
    softwareWD: daysInMonth - sundays,
  };
}

interface AttendanceEntry { name: string; daysWorked: number; }

export interface SalaryEntry {
  employeeName: string;
  designation: string;
  organisation: string;
  monthlySalary: number;
  daysPresent: number;
  otDuties: number;
  grossSalary: number;
  deductions: number;
  netSalary: number;
  isSoftware: boolean;
}

export interface FillResult {
  filled: number;
  notFound: number;
  skipped: string[];
  phoneticMatches: Array<{ salaryName: string; attendanceName: string; method: string; score: number; days: number }>;
  matchedNames: string[];
  unmatchedNames: string[];
  entries: SalaryEntry[];
  monthInfo: { daysInMonth: number; sundays: number; hospitalWD: number; softwareWD: number };
  buffer: Buffer;
}

export function fillSalarySheet(
  salaryBuffer: Buffer,
  attendanceBuffer: Buffer,
  sheetName: string,
  month: string,
): FillResult {
  const monthInfo = getMonthInfo(month);

  // Parse attendance file
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
      if (cv != null && /\d{2}:\d{2}/.test(String(cv))) daysWorked++;
    }
    const nk = norm(name);
    if (!attendanceByNormName.has(nk) || attendanceByNormName.get(nk)!.daysWorked < daysWorked) {
      attendanceByNormName.set(nk, { name, daysWorked });
    }
  }

  // Parse salary sheet
  const salWb = xlsx.read(salaryBuffer, { type: 'buffer', cellStyles: true });
  const ws = salWb.Sheets[sheetName];
  if (!ws) throw new Error(`Sheet "${sheetName}" not found. Available: ${salWb.SheetNames.join(', ')}`);
  const range = xlsx.utils.decode_range(ws['!ref'] || 'A1:I1');

  const HEADER_ROW = 1;
  const COL_NAME = 1, COL_BASIC = 3, COL_DAYS = 4, COL_PAYMENT = 5, COL_PAID = 6, COL_PAYABLE = 7, COL_ORG = 8, COL_OT_DUTIES = 9;

  let filled = 0, notFound = 0;
  const phoneticMatches: FillResult['phoneticMatches'] = [];
  const matchedNames: string[] = [];
  const unmatchedNames: string[] = [];
  const skipped: string[] = [];
  const entries: SalaryEntry[] = [];

  for (let r = HEADER_ROW + 1; r <= range.e.r; r++) {
    const nameCell = ws[xlsx.utils.encode_cell({ r, c: COL_NAME })];
    if (!nameCell || !nameCell.v) continue;
    const sheetNameVal = String(nameCell.v).trim();
    if (!sheetNameVal || sheetNameVal.length < 2) continue;
    const snNorm = norm(sheetNameVal);

    // Find attendance — name matching with full-name awareness
    let attData: AttendanceEntry | null = null;
    let method = 'NONE';
    let score = 0;

    // 1. Exact full-name match
    if (attendanceByNormName.has(snNorm)) {
      attData = attendanceByNormName.get(snNorm)!;
      method = 'EXACT'; score = 1;
    }

    // 2. Substring match (attendance name contains salary name)
    if (!attData) {
      for (const [attN, att] of attendanceByNormName) {
        if (snNorm.length >= 4 && attN.includes(snNorm)) {
          attData = att; method = 'SUBSTRING'; score = 0.9; break;
        }
      }
    }

    // 3. Phonetic match — requires BOTH first AND last name to match
    //    Prevents confusion between people with same first name (Ruchika Zade vs Ruchika Jambulkar)
    if (!attData) {
      const snParts = snNorm.split(' ').filter(p => p.length >= 2);
      const snFirst = snParts[0] || '';
      const snLast = snParts.length > 1 ? snParts[snParts.length - 1] : '';
      let bestScore = 0;
      for (const [attN, att] of attendanceByNormName) {
        const attParts = attN.split(' ').filter(p => p.length >= 2);
        const attFirst = attParts[0] || '';
        const attLast = attParts.length > 1 ? attParts[attParts.length - 1] : '';

        // First name must match phonetically
        if (snFirst.length >= 4 && attFirst.length >= 4) {
          const fs = phoneticScore(snFirst, attFirst);
          if (fs >= 0.75) {
            // If both have last names, last name must also match (at least loosely)
            let lastNameOk = true;
            if (snLast && attLast) {
              const ls = phoneticScore(snLast, attLast);
              lastNameOk = ls >= 0.6;
            }
            if (lastNameOk) {
              const combined = fs * 0.5 + phoneticScore(snNorm, attN) * 0.5;
              if (combined >= 0.6 && combined > bestScore) {
                attData = att; method = 'PHONETIC'; score = combined; bestScore = combined;
              }
            }
          }
        }
      }
    }

    // Read salary sheet columns
    const basicCell = ws[xlsx.utils.encode_cell({ r, c: COL_BASIC })];
    const basic = Number(basicCell?.v) || 0;
    const paidCell = ws[xlsx.utils.encode_cell({ r, c: COL_PAID })];
    const advance = Number(paidCell?.v) || 0;
    const otCell = ws[xlsx.utils.encode_cell({ r, c: COL_OT_DUTIES })];
    const otDuties = Number(otCell?.v) || 0;
    const desigCell = ws[xlsx.utils.encode_cell({ r, c: 2 })];
    const desig = String(desigCell?.v || '').trim();
    const orgCell = ws[xlsx.utils.encode_cell({ r, c: COL_ORG })];
    const org = String(orgCell?.v || '').trim().toLowerCase();
    const isSoftware = org === 'rafttar' || org === 'it' || org === 'software';
    const generalShiftDepts = ['account', 'admin', 'reception', 'lab', 'it support'];
    const isGeneralShift = !isSoftware && generalShiftDepts.some(d => org.includes(d) || desig.toLowerCase().includes(d));
    const isShiftWorker = !isSoftware && !isGeneralShift;

    if (attData && attData.daysWorked > 0) {
      const days = attData.daysWorked;
      const excelRow = r + 1;
      const wd = isSoftware ? monthInfo.softwareWD : monthInfo.hospitalWD;

      let gross: number, deductions: number, net: number;

      if (isSoftware) {
        const swWD = monthInfo.softwareWD;
        const expectedDays = swWD - 2;
        const capped = Math.min(days, expectedDays);
        const absent = Math.max(0, expectedDays - capped);
        gross = basic;
        const absentDeduction = Math.round((basic / swWD) * absent);
        deductions = advance + absentDeduction;
        net = Math.max(0, gross - deductions);
        ws[xlsx.utils.encode_cell({ r, c: COL_DAYS })] = { t: 'n', v: capped };
        ws[xlsx.utils.encode_cell({ r, c: COL_PAYMENT })] = { t: 'n', v: gross };
        ws[xlsx.utils.encode_cell({ r, c: COL_PAYABLE })] = { t: 'n', v: net };
      } else if (isGeneralShift) {
        const gsWD = monthInfo.softwareWD;
        const totalDays = Math.min(days + monthInfo.sundays, gsWD);
        gross = Math.round((basic / gsWD) * totalDays);
        deductions = advance;
        net = Math.max(0, gross - deductions);
        ws[xlsx.utils.encode_cell({ r, c: COL_DAYS })] = { t: 'n', v: totalDays };
        ws[xlsx.utils.encode_cell({ r, c: COL_PAYMENT })] = { t: 'n', v: gross };
        ws[xlsx.utils.encode_cell({ r, c: COL_PAYABLE })] = { t: 'n', v: net };
      } else {
        const swWD = monthInfo.hospitalWD;
        const otAmount = Math.round((basic / swWD) * otDuties);
        gross = Math.round((basic / swWD) * days + otAmount);
        deductions = advance;
        net = Math.max(0, gross - deductions);
        ws[xlsx.utils.encode_cell({ r, c: COL_DAYS })] = { t: 'n', v: days };
        ws[xlsx.utils.encode_cell({ r, c: COL_PAYMENT })] = { t: 'n', f: `D${excelRow}/${swWD}*E${excelRow}` };
        ws[xlsx.utils.encode_cell({ r, c: COL_PAYABLE })] = { t: 'n', v: net };
      }

      entries.push({ employeeName: sheetNameVal, designation: desig, organisation: org, monthlySalary: basic, daysPresent: days, otDuties, grossSalary: gross, deductions, netSalary: net, isSoftware });
      filled++;
      matchedNames.push(sheetNameVal);
      if (method === 'PHONETIC' || method === 'CLOSE') {
        phoneticMatches.push({ salaryName: sheetNameVal, attendanceName: attData.name, method, score: Math.round(score * 100) / 100, days });
      }
    } else {
      notFound++;
      unmatchedNames.push(sheetNameVal);
      skipped.push(sheetNameVal);
    }
  }

  const outBuffer = xlsx.write(salWb, { type: 'buffer', bookType: 'xlsx' });

  return { filled, notFound, skipped, phoneticMatches, matchedNames, unmatchedNames, entries, monthInfo, buffer: outBuffer };
}