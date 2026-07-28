// Per-employee punch timing PDF (direct download, no print dialog).
//
// Builds a PDF for ONE employee with timing sections:
// 1) Before 9:00
// 2) 9:00 - 9:15
// 3) 9:15 - 9:30
// 4) After 9:30

import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import { parseTimeToMinutes } from '../../utils/punchTiming';

export interface EmployeePunchDay {
  date: string;
  timeIn: string | null;
  timeOut: string | null;
  workingHours?: number | null;
}

export interface EmployeePunchPdfInput {
  name: string;
  employeeNumber?: string | null;
  biometricId?: string | null;
  department?: string | null;
  designation?: string | null;
  periodLabel?: string;
  days: EmployeePunchDay[];
}

type LateBucket = 'b_915' | 'b_930' | 'b_after';
const LATE_BUCKET_META: Record<LateBucket, { label: string; color: [number, number, number] }> = {
  b_915: { label: '9:00 - 9:15', color: [217, 119, 7] },
  b_930: { label: '9:15 - 9:30', color: [234, 88, 12] },
  b_after: { label: 'After 9:30', color: [220, 38, 38] },
};

function lateBucket(inMin: number): LateBucket | null {
  if (inMin < 9 * 60) return null;
  if (inMin <= 9 * 60 + 15) return 'b_915';
  if (inMin <= 9 * 60 + 30) return 'b_930';
  return 'b_after';
}

function otherTimingLabel(day: EmployeePunchDay): string {
  const inMin = parseTimeToMinutes(day.timeIn);
  if (inMin != null && inMin < 9 * 60) return 'Before 9:00';
  if (!day.timeIn && day.timeOut) return 'No punch-in';
  if (day.timeIn && !day.timeOut) return 'No punch-out';
  return 'Other';
}

function fmtDate(iso: string): string {
  const p = String(iso).split('T')[0].split('-');
  if (p.length === 3) return `${p[2]}/${p[1]}/${p[0]}`;
  return iso;
}

interface PunchRow {
  date: string;
  timeIn: string;
  timeOut: string;
  hours: string;
  timing: string;
  bucket?: LateBucket;
}

interface PunchRowGroups {
  before9Rows: PunchRow[];
  b915Rows: PunchRow[];
  b930Rows: PunchRow[];
  after930Rows: PunchRow[];
  otherRows: PunchRow[];
}

function hasPunchData(day: EmployeePunchDay): boolean {
  return !!day.timeIn || !!day.timeOut || day.workingHours != null;
}

function computePunchRows(days: EmployeePunchDay[]): PunchRowGroups {
  const before9Rows: PunchRow[] = [];
  const b915Rows: PunchRow[] = [];
  const b930Rows: PunchRow[] = [];
  const after930Rows: PunchRow[] = [];
  const otherRows: PunchRow[] = [];

  for (const d of days) {
    if (!hasPunchData(d)) continue;

    const inMin = parseTimeToMinutes(d.timeIn);
    const bucket = inMin == null ? null : lateBucket(inMin);
    const base = {
      date: d.date,
      timeIn: d.timeIn || '',
      timeOut: d.timeOut || '',
      hours: d.workingHours != null ? String(d.workingHours) : '',
    };

    if (bucket === 'b_915') {
      b915Rows.push({ ...base, timing: LATE_BUCKET_META[bucket].label, bucket });
    } else if (bucket === 'b_930') {
      b930Rows.push({ ...base, timing: LATE_BUCKET_META[bucket].label, bucket });
    } else if (bucket === 'b_after') {
      after930Rows.push({ ...base, timing: LATE_BUCKET_META[bucket].label, bucket });
    } else if (inMin != null && inMin < 9 * 60) {
      before9Rows.push({ ...base, timing: 'Before 9:00' });
    } else {
      otherRows.push({ ...base, timing: otherTimingLabel(d) });
    }
  }

  const byDate = (a: PunchRow, b: PunchRow) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0);
  before9Rows.sort(byDate);
  b915Rows.sort(byDate);
  b930Rows.sort(byDate);
  after930Rows.sort(byDate);
  otherRows.sort(byDate);
  return { before9Rows, b915Rows, b930Rows, after930Rows, otherRows };
}

function addSectionTitle(doc: jsPDF, title: string, subtitle: string, margin: number, y: number): number {
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(13);
  doc.setTextColor(15, 23, 42);
  doc.text(title, margin, y);
  y += 14;

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(100, 116, 139);
  doc.text(subtitle, margin, y);
  return y + 10;
}

function addEmptyMessage(doc: jsPDF, message: string, margin: number, y: number): number {
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.setTextColor(22, 163, 74);
  doc.text(message, margin, y + 14);
  return y + 34;
}

function ensureSectionSpace(doc: jsPDF, y: number): number {
  const pageHeight = doc.internal.pageSize.getHeight();
  if (y > pageHeight - 120) {
    doc.addPage();
    return 40;
  }
  return y;
}

function renderPunchTable(doc: jsPDF, rows: PunchRow[], startY: number, margin: number): number {
  autoTable(doc, {
    startY,
    head: [['Date', 'Punch In', 'Punch Out', 'Hours', 'Timing']],
    body: rows.map(r => [fmtDate(r.date), r.timeIn || '-', r.timeOut || '-', r.hours || '-', r.timing]),
    styles: { font: 'helvetica', fontSize: 10, cellPadding: 6, textColor: [51, 65, 85] },
    headStyles: { fillColor: [241, 245, 249], textColor: [71, 85, 105], fontStyle: 'bold' as const, fontSize: 9 },
    columnStyles: {
      1: { halign: 'right' as const, fontStyle: 'bold' as const },
      2: { halign: 'right' as const },
      3: { halign: 'right' as const },
      4: { halign: 'center' as const },
    },
    alternateRowStyles: { fillColor: [249, 250, 251] },
    margin: { left: margin, right: margin },
    didParseCell: (data) => {
      if (data.section !== 'body' || data.column.index !== 4) return;
      const row = rows[data.row.index];
      if (row.bucket) {
        const meta = LATE_BUCKET_META[row.bucket];
        data.cell.styles.fillColor = meta.color;
        data.cell.styles.textColor = [255, 255, 255];
        data.cell.styles.fontStyle = 'bold';
      } else if (row.timing === 'Before 9:00') {
        data.cell.styles.fillColor = [220, 252, 231];
        data.cell.styles.textColor = [22, 101, 52];
        data.cell.styles.fontStyle = 'bold';
      } else {
        data.cell.styles.fillColor = [226, 232, 240];
        data.cell.styles.textColor = [71, 85, 105];
        data.cell.styles.fontStyle = 'bold';
      }
    },
  });

  return ((doc as any).lastAutoTable?.finalY || startY) + 24;
}

// Generates the PDF and triggers a direct file download (no print dialog).
export function downloadEmployeePunchPdf(input: EmployeePunchPdfInput): void {
  const { before9Rows, b915Rows, b930Rows, after930Rows, otherRows } = computePunchRows(input.days);
  const lateRows = [...b915Rows, ...b930Rows, ...after930Rows];
  const counts: Record<LateBucket, number> = { b_915: 0, b_930: 0, b_after: 0 };
  counts.b_915 = b915Rows.length;
  counts.b_930 = b930Rows.length;
  counts.b_after = after930Rows.length;

  const totalPunchRecords = before9Rows.length + lateRows.length + otherRows.length;
  const doc = new jsPDF({ unit: 'pt', format: 'a4' });
  const pageWidth = doc.internal.pageSize.getWidth();
  const margin = 40;
  let y = margin;

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(18);
  doc.setTextColor(30, 41, 59);
  doc.text('Punch Timing Report', margin, y + 10);
  y += 28;

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(13);
  doc.setTextColor(15, 23, 42);
  doc.text(input.name, margin, y);
  y += 16;

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  doc.setTextColor(100, 116, 139);
  const idLabel = input.employeeNumber || input.biometricId || '';
  const metaParts = [idLabel && `ID: ${idLabel}`, input.department, input.designation].filter(Boolean) as string[];
  if (metaParts.length) {
    doc.text(metaParts.join('   |   '), margin, y);
    y += 13;
  }
  if (input.periodLabel) {
    doc.text(`Period: ${input.periodLabel}`, margin, y);
    y += 13;
  }
  doc.text(`Generated ${new Date().toLocaleString()}`, margin, y);
  y += 18;

  const chips: Array<{ k: string; v: string; color: [number, number, number] }> = [
    { k: 'TOTAL RECORDS', v: String(totalPunchRecords), color: [71, 85, 105] },
    { k: 'BEFORE 9:00', v: String(before9Rows.length), color: [22, 163, 74] },
    { k: '9:00 - 9:15', v: String(counts.b_915), color: LATE_BUCKET_META.b_915.color },
    { k: '9:15 - 9:30', v: String(counts.b_930), color: LATE_BUCKET_META.b_930.color },
    { k: 'AFTER 9:30', v: String(counts.b_after), color: LATE_BUCKET_META.b_after.color },
  ];
  const chipW = (pageWidth - margin * 2) / chips.length;
  const chipPad = 6;
  chips.forEach((c, i) => {
    const x = margin + i * chipW;
    doc.setDrawColor(226, 232, 240);
    doc.setFillColor(248, 250, 252);
    doc.roundedRect(x + chipPad, y, chipW - chipPad * 2, 44, 6, 6, 'FD');
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(100, 116, 139);
    doc.text(c.k, x + chipPad + 10, y + 14);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(18);
    doc.setTextColor(c.color[0], c.color[1], c.color[2]);
    doc.text(c.v, x + chipPad + 10, y + 38);
  });
  y += 62;

  y = addSectionTitle(doc, 'Before 9:00 Punches', 'Punch-ins before 9:00. These are on-time or early records.', margin, y);
  y = before9Rows.length
    ? renderPunchTable(doc, before9Rows, y, margin)
    : addEmptyMessage(doc, 'No punch-ins before 9:00.', margin, y);

  y = ensureSectionSpace(doc, y);
  y = addSectionTitle(doc, '9:00 - 9:15 Punches', 'Punch-ins from 9:00 through 9:15.', margin, y);
  y = b915Rows.length
    ? renderPunchTable(doc, b915Rows, y, margin)
    : addEmptyMessage(doc, 'No punch-ins from 9:00 to 9:15.', margin, y);

  y = ensureSectionSpace(doc, y);
  y = addSectionTitle(doc, '9:15 - 9:30 Punches', 'Punch-ins after 9:15 through 9:30.', margin, y);
  y = b930Rows.length
    ? renderPunchTable(doc, b930Rows, y, margin)
    : addEmptyMessage(doc, 'No punch-ins from 9:15 to 9:30.', margin, y);

  y = ensureSectionSpace(doc, y);
  y = addSectionTitle(doc, 'After 9:30 Punches', 'Punch-ins after 9:30.', margin, y);
  y = after930Rows.length
    ? renderPunchTable(doc, after930Rows, y, margin)
    : addEmptyMessage(doc, 'No punch-ins after 9:30.', margin, y);

  y = ensureSectionSpace(doc, y);
  y = addSectionTitle(doc, 'Other Punch Records', 'Records without a normal punch-in timing, such as missing punch-in or punch-out.', margin, y);
  if (otherRows.length) {
    renderPunchTable(doc, otherRows, y, margin);
  } else {
    addEmptyMessage(doc, 'No other punch records with timing details.', margin, y);
  }

  const pages = doc.getNumberOfPages();
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(148, 163, 184);
    const footY = doc.internal.pageSize.getHeight() - 18;
    doc.text(
      `HRPulse - punch timing for ${input.name}. Includes late punch-ins and other available punch records.`,
      margin,
      footY,
    );
    doc.text(`Page ${i} / ${pages}`, pageWidth - margin, footY, { align: 'right' });
  }

  const safe = (input.name || 'employee').replace(/[^a-z0-9]+/gi, '_').replace(/^_+|_+$/g, '') || 'employee';
  doc.save(`punch-timing-${safe}.pdf`);
}
