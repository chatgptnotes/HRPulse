import * as XLSX from 'xlsx';
import { Employee } from './types';

const DATE_LABEL = new Date().toISOString().slice(0, 10);

function timingLabel(e: Employee): string {
  if (!e.shiftStartTime && !e.shiftEndTime) return '';
  return `${e.shiftStartTime || '--:--'} - ${e.shiftEndTime || '--:--'}`;
}

// Exports the given employees to a formatted Excel workbook and triggers a download.
export function exportEmployeesCsv(employees: Employee[]): void {
  const rows = employees.map((e, index) => ({
    'S.No': index + 1,
    'Employee ID': e.employeeNumber || '',
    'Employee Name': e.name || '',
    Email: e.email || '',
    Mobile: e.mobile || '',
    Department: e.department || '',
    Designation: e.designation || '',
    Shift: e.shift || '',
    'Shift Start Time': e.shiftStartTime || '',
    'Shift End Time': e.shiftEndTime || '',
    Timing: timingLabel(e),
    'Monthly Salary': Number(e.monthlySalary) || 0,
    Status: e.status || '',
    'Paid Leaves Eligible': e.paidLeavesEligible === false ? 'No' : 'Yes',
    'Overtime Eligible': e.overtimeEligible ? 'Yes' : 'No',
  }));

  const sheet = XLSX.utils.json_to_sheet(rows);
  sheet['!cols'] = [
    { wch: 8 },
    { wch: 14 },
    { wch: 24 },
    { wch: 34 },
    { wch: 16 },
    { wch: 18 },
    { wch: 20 },
    { wch: 16 },
    { wch: 16 },
    { wch: 16 },
    { wch: 18 },
    { wch: 16 },
    { wch: 12 },
    { wch: 20 },
    { wch: 18 },
  ];
  sheet['!freeze'] = { xSplit: 0, ySplit: 1 };

  const salaryColumn = 'L';
  for (let row = 2; row <= employees.length + 1; row += 1) {
    const cell = sheet[`${salaryColumn}${row}`];
    if (cell) {
      cell.t = 'n';
      cell.z = '₹ #,##0';
    }
  }

  const workbook = XLSX.utils.book_new();
  workbook.Props = {
    Title: 'HRPulse Employee Master',
    Subject: 'Employee Export',
    Author: 'HRPulse',
    CreatedDate: new Date(),
  };
  XLSX.utils.book_append_sheet(workbook, sheet, 'Employees');
  XLSX.writeFile(workbook, `employees-${DATE_LABEL}.xlsx`, { compression: true });
}
