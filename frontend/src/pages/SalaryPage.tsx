import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { format } from 'date-fns';
import * as XLSX from 'xlsx';
import * as api from '../api';
import EmailDraftModal from '../components/email/EmailDraftModal';
import LopBreakdown from '../components/salary/LopBreakdown';
import ManagementAdjustmentModal from '../components/salary/ManagementAdjustmentModal';
import CalculationDetailsModal from '../components/salary/CalculationDetailsModal';
import { formatINR } from '../lib/dayWiseSalary';
import TablePagination, { PAGE_SIZE } from '../components/TablePagination';
import PayrollSummaryBar from '../components/salary/PayrollSummaryBar';
import DepartmentPillFilters from '../components/salary/DepartmentPillFilters';
import EmployeeDrawer from '../components/salary/EmployeeDrawer';
import SalaryStatsGrid from '../components/salary/SalaryStatsGrid';
import { useAuth } from '../auth/AuthContext';

export default function SalaryPage() {
  const qc = useQueryClient();
  const { user } = useAuth();
  const currentMonth = format(new Date(), 'yyyy-MM');
  const [month, setMonth] = useState(currentMonth);
  const monthWasSelected = useRef(false);
  const [toast, setToast] = useState('');
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('all');
  const [companyFilter, setCompanyFilter] = useState('All');
  const [page, setPage] = useState(1);
  const [showPrintOptions, setShowPrintOptions] = useState(false);
  const [departmentPill, setDepartmentPill] = useState('All');
  const [drawerEmployee, setDrawerEmployee] = useState<any | null>(null);
  // The whole payroll row, not just the employee: the details modal needs the
  // deduction and the salary to show what each day was worth.
  const [attendanceRow, setAttendanceRow] = useState<any | null>(null);
  // Which attendance statuses the details modal should list. null = all records.
  const [attendanceFilter, setAttendanceFilter] = useState<{ statuses: string[]; label: string; includeSundays?: boolean; note?: string; skipProtected?: boolean; showProtectedOnly?: boolean; protectedCount?: number; filterMinCredit?: number } | null>(null);
  // Which employee's LOP is being explained, if any.
  const [lopExplain, setLopExplain] = useState<any | null>(null);
  // Management adjustment modal state
  const [managementAdjustmentRow, setManagementAdjustmentRow] = useState<any | null>(null);
  // Calculation details modal state
  const [calculationDetailsRow, setCalculationDetailsRow] = useState<any | null>(null);

  const openAttendance = (row: any, filter: { statuses: string[]; label: string; includeSundays?: boolean; note?: string; skipProtected?: boolean; showProtectedOnly?: boolean; protectedCount?: number; filterMinCredit?: number } | null = null) => {
    if (!latestUpload?.id) return;
    setAttendanceFilter(filter);
    setAttendanceRow(row);
  };

  const { data: employees = [] } = useQuery({ queryKey: ['employees'], queryFn: () => api.getEmployees().then(r => r.data as any[]) });
  const { data: configs = [] } = useQuery({ queryKey: ['salary-configs', month], queryFn: () => api.getSalaryConfigs(month).then(r => r.data as any[]) });

  const { data: uploads = [] } = useQuery({ queryKey: ['uploads'], queryFn: () => api.getUploads().then(r => r.data as any[]) });
  // Ignore an empty/failed import when choosing the attendance month.
  // Otherwise Salary/LOP can incorrectly show Attendance = 0 even though a
  // previous successful upload contains records.
  const latestUpload = (uploads as any[]).find(upload => Number(upload.rowCount ?? upload.row_count ?? 0) > 0) || (uploads as any[])[0];
  useEffect(() => {
    if (!monthWasSelected.current && latestUpload?.periodMonth && latestUpload.periodMonth !== month) {
      setMonth(latestUpload.periodMonth);
    }
  }, [latestUpload?.periodMonth, month]);
  const { data: deductions = [] } = useQuery({
    queryKey: ['deductions', latestUpload?.id],
    queryFn: () => api.getSalaryDeductions(latestUpload!.id).then(r => r.data as any[]),
    enabled: !!latestUpload,
  });

  // Fetch all management adjustments (including standalone ones with upload_id 0)
  const { data: allManagementAdjustments = [] } = useQuery({
    queryKey: ['all-management-adjustments'],
    queryFn: () => api.getAllManagementAdjustments().then(r => r.data as any[]),
  });

  const showToast = (msg: string) => { setToast(msg); setTimeout(() => setToast(''), 3000); };

  const companyOf = (emp: any) => {
    const value = [emp.organisation, emp.organisation_name, emp.organization, emp.company, emp.entity, emp.department].filter(Boolean).join(' ').toLowerCase().replace(/[^a-z0-9]+/g, ' ');
    // Rafttar first: the IT team is recorded as Rafttar/Hope, and matching
    // Hope first would file them under the hospital.
    if (value.includes('rafttar')) return 'Rafttar';
    if (value.includes('ayushman')) return 'Ayushman';
    if (value.includes('hope')) return 'Hope';
    if (/(^|[^a-z])it([^a-z]|$)|information technology/.test(value)) return 'IT';
    return 'Other';
  };

  const rows = useMemo(() => {
    const deductionMap = new Map((deductions as any[]).map(d => [d.employeeId, d]));
    const configMap = new Map((configs as any[]).map(c => [c.employeeId, c]));

    // Build map of standalone management adjustments (upload_id 0 or current upload)
    const managementMap = new Map<number, { amount: number; remarks: string; lastUpdated?: string }>();
    for (const adj of allManagementAdjustments as any[]) {
      // Include standalone adjustments (upload_id 0) and adjustments for current upload
      if (!adj.upload_id || adj.upload_id === 0 || adj.upload_id === latestUpload?.id) {
        // If we already have an adjustment for this employee, keep the most recent one
        const existing = managementMap.get(adj.employee_id);
        if (!existing || new Date(adj.updated_at) > new Date(existing.lastUpdated || 0)) {
          managementMap.set(adj.employee_id, {
            amount: Number(adj.amount),
            remarks: adj.remarks,
            lastUpdated: adj.updated_at
          });
        }
      }
    }

    return (employees as any[]).map(emp => {
      const deduction = deductionMap.get(emp.id);
      const config = configMap.get(emp.id);
      const mgmtAdjustment = managementMap.get(emp.id);

      // Merge standalone management adjustment into deduction if exists
      let enhancedDeduction = deduction;
      if (mgmtAdjustment && mgmtAdjustment.amount !== 0) {
        // If deduction exists but has no management adjustment, or if no deduction exists
        if (!deduction || !deduction.managementAdjustment) {
          const baseNetPayable = deduction?.netPayable || 0;
          // For standalone adjustments (no attendance), netPayable = management adjustment amount
          const standaloneNetPayable = !deduction ? mgmtAdjustment.amount : baseNetPayable + mgmtAdjustment.amount;

          enhancedDeduction = {
            ...deduction,
            managementAdjustment: mgmtAdjustment.amount,
            managementAdjustmentRemarks: mgmtAdjustment.remarks,
            // Recalculate netPayable to include management adjustment
            netPayable: standaloneNetPayable
          };
        }
      }

      // An employee with only absent rows still gets a deductions entry, so
      // has attendance means at least one day actually worked.
      const hasAttendance = !!deduction && Number(deduction.presentDays || 0) > 0;
      const hasSalary = Number(config?.basicSalary || 0) > 0;
      const hasLop = Number(deduction?.lopAmount || 0) > 0;
      const hasManagementAdjustment = mgmtAdjustment && mgmtAdjustment.amount !== 0;

      return { emp, deduction: enhancedDeduction, config, hasAttendance, hasSalary, hasLop, hasManagementAdjustment };
    });
  }, [employees, deductions, configs, allManagementAdjustments, latestUpload?.id]);

  // No attendance for this month means every row would fail the default
  // With attendance filter and the whole payroll list would look empty.
  // Fall back to showing everyone so salaries stay visible.
  const noAttendanceData = rows.length > 0 && rows.every(row => !row.hasAttendance);

  const filteredRows = useMemo(() => {
    const query = search.trim().toLowerCase();
    const normalizedQuery = query.replace(/[^a-z0-9]+/g, '');
    return rows.filter(row => {
      const searchable = [row.emp.name, row.emp.email, row.emp.employeeNumber, row.emp.employee_number, row.emp.employeeId, row.emp.id]
        .filter(value => value !== null && value !== undefined)
        .map(value => String(value).toLowerCase())
        .join(' ');
      const normalizedSearchable = searchable.replace(/[^a-z0-9]+/g, '');
      if (query && !searchable.includes(query) && !normalizedSearchable.includes(normalizedQuery)) return false;
      if (companyFilter !== 'All' && companyOf(row.emp) !== companyFilter) return false;
      if (departmentPill !== 'All') {
        const empDept = (row.emp.department || '').toLowerCase();
        const org = (row.emp.organisation || row.emp.organization || '').toLowerCase();
        if (departmentPill === 'Doctors' && !/(doctor|dr\.|physician|medical)/i.test(empDept + ' ' + org)) return false;
        if (departmentPill === 'Nursing' && !/(nurse|nursing|staff)/i.test(empDept + ' ' + org)) return false;
        if (departmentPill === 'Administration' && !/(admin|management|director)/i.test(empDept)) return false;
        if (departmentPill === 'Accounts' && !/(account|finance)/i.test(empDept)) return false;
        if (departmentPill === 'Marketing' && !/(market|sales)/i.test(empDept)) return false;
        if (departmentPill === 'HR' && !/(hr|human)/i.test(empDept)) return false;
        if (departmentPill === 'IT' && !/\bit\b|information technology/i.test(empDept + ' ' + org)) return false;
      }
      if (filter === 'attendance') return noAttendanceData ? true : row.hasAttendance;
      if (filter === 'missing-attendance') return !row.hasAttendance;
      if (filter === 'lop') return row.hasLop;
      if (filter === 'missing-salary') return !row.hasSalary;
      if (filter === 'payable') return row.hasSalary;
      return true;
    }).sort((a, b) => Number(b.hasSalary) - Number(a.hasSalary));
  }, [rows, search, filter, companyFilter, departmentPill, noAttendanceData]);

  // Changing what is being looked for starts the reading again from the top;
  // staying on page 7 of a freshly narrowed list shows an empty table.
  useEffect(() => { setPage(1); }, [search, filter, companyFilter, departmentPill, month]);
  const visibleRows = filteredRows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const hasActiveFilters = Boolean(search.trim()) || filter !== 'attendance' || companyFilter !== 'All' || departmentPill !== 'All';
  const clearFilters = () => { setSearch(''); setFilter('attendance'); setCompanyFilter('All'); setDepartmentPill('All'); };

  const summary = useMemo(() => ({
    total: rows.length,
    attendance: rows.filter(row => row.hasAttendance).length,
    lop: rows.filter(row => row.hasLop).length,
    extraPay: rows.filter(row => Number(row.deduction?.extraPayment || 0) > 0).length,
    missingSalary: rows.filter(row => !row.hasSalary).length,
    // Payroll financial summary
    totalPayroll: rows.reduce((sum, row) => sum + Number(row.config?.basicSalary || 0), 0),
    netPayable: rows.reduce((sum, row) => sum + Number(row.deduction?.netPayable || 0), 0),
    totalExtraPay: rows.reduce((sum, row) => sum + Number(row.deduction?.extraPayment || 0), 0),
    totalLopAmount: rows.reduce((sum, row) => sum + Number(row.deduction?.lopAmount || 0), 0),
  }), [rows]);

  const printSalarySheet = (company: string) => {
    const printable = rows.filter(row => row.hasSalary && row.hasAttendance && (company === 'All' || companyOf(row.emp) === company));
    const money = (value: number) => `₹${value.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
    // Check if any employee has management adjustments
    const hasManagementAdjustments = printable.some(row => Number(row.deduction?.managementAdjustment || 0) !== 0);
    const hasRuleEffects = printable.some(row => (row.deduction?.ruleEffects || []).length > 0);
    const body = printable.map(({ emp, config: cfg, deduction: ded }, index) => {
      const salary = Number(cfg?.basicSalary || 0);
      const lop = Number(ded?.lopAmount || 0);
      const extra = Number(ded?.extraPayment || 0);
      const mgmt = Number(ded?.managementAdjustment || 0);
      const ruleDed = Number(ded?.ruleDeductions || 0);
      const ruleBon = Number(ded?.ruleBonus || 0);
      const grossSalary = salary + extra;
      const net = Number(ded?.netPayable || 0);
      const ruleCell = hasRuleEffects
        ? (ruleDed > 0 ? '-' + money(ruleDed) : '') + (ruleBon > 0 ? (ruleDed > 0 ? ' / +' : '+') + money(ruleBon) : '') || '—'
        : '—';
      const employeeId = emp.employee_number || emp.employeeNumber || emp.employeeId || emp.id || '-';
      const designation = emp.designation || '-';
      const daysPresent = ded?.presentDays ?? 0;
      const duties = ded?.extraPayableDays ?? 0;
      const ruleTD = hasRuleEffects ? `<td>${ruleCell}</td>` : '';
      if (hasManagementAdjustments) {
        return `<tr><td>${index + 1}</td><td>${emp.name || ''}</td><td>${employeeId}</td><td>${designation}</td><td>${money(salary)}</td><td>${daysPresent}</td><td>${duties}</td><td>${money(grossSalary)}</td><td>${money(lop)}</td>${ruleTD}<td>${mgmt !== 0 ? (mgmt > 0 ? '+' : '') + money(mgmt) : '—'}</td><td>${money(net)}</td></tr>`;
      }
      return `<tr><td>${index + 1}</td><td>${emp.name || ''}</td><td>${employeeId}</td><td>${designation}</td><td>${money(salary)}</td><td>${daysPresent}</td><td>${duties}</td><td>${money(grossSalary)}</td><td>${money(lop)}</td>${ruleTD}<td>${money(net)}</td></tr>`;
    }).join('');
    const ruleTH = hasRuleEffects ? '<th>Rule Adjustments</th>' : '';
    const headerRow = hasManagementAdjustments
      ? `<tr><th>S.No</th><th>Employee Name</th><th>Employee ID</th><th>Designation</th><th>Monthly Salary</th><th>Days Present</th><th>Duties</th><th>Gross Salary</th><th>Deductions</th>${ruleTH}<th>Management Decision</th><th>Net Salary</th></tr>`
      : `<tr><th>S.No</th><th>Employee Name</th><th>Employee ID</th><th>Designation</th><th>Monthly Salary</th><th>Days Present</th><th>Duties</th><th>Gross Salary</th><th>Deductions</th>${ruleTH}<th>Net Salary</th></tr>`;
    const colspan = (hasManagementAdjustments ? 11 : 10) + (hasRuleEffects ? 1 : 0);
    const popup = window.open('', '_blank', 'width=1100,height=750');
    if (!popup) return;
    popup.document.write(`<html><head><title>Salary Sheet - ${company}</title><style>body{font-family:Arial,sans-serif;padding:24px;color:#172033}h1{margin:0 0 4px}p{color:#64748b}table{width:100%;border-collapse:collapse;margin-top:20px}th,td{border:1px solid #cbd5e1;padding:9px;text-align:left}th{background:#eef2ff}td:nth-child(n+5),th:nth-child(n+5){text-align:right}td:nth-child(6),td:nth-child(7),th:nth-child(6),th:nth-child(7){text-align:center}@media print{button{display:none}}</style></head><body><h1>Salary Sheet</h1><p>${company === 'All' ? 'All Companies' : company} · ${month}</p><button onclick=window.print()>Print</button><table><thead>${headerRow}</thead><tbody>${body || `<tr><td colspan=${colspan}>No salaried employees found</td></tr>`}</tbody></table></body></html>`);
    popup.document.close();
    popup.focus();
    setShowPrintOptions(false);
  };

  const formatDateToDDMonYY = (dateStr: string | null | undefined): string => {
    if (!dateStr) return '';
    const date = new Date(dateStr);
    if (isNaN(date.getTime())) return '';
    const day = String(date.getDate()).padStart(2, '0');
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const month = months[date.getMonth()];
    const year = String(date.getFullYear()).slice(-2);
    return `${day}-${month}-${year}`;
  };

  const formatAadhar = (aadhar: string | null | undefined): string => {
    if (!aadhar) return '';
    const cleaned = aadhar.replace(/\D/g, '');
    if (cleaned.length !== 12) return aadhar;
    return `${cleaned.slice(0, 4)}-${cleaned.slice(4, 8)}-${cleaned.slice(8)}`;
  };

  const transformSalaryForExport = (rows: any[]) => {
    return rows.map(({ emp, config: cfg, deduction: ded }) => {
      const employeeName = emp.name || '';
      const employeeId = emp.employee_number || emp.employeeNumber || emp.employeeId || emp.id || '-';
      const designation = emp.designation || '-';
      const monthlySalary = Number(cfg?.basicSalary || 0);
      const daysPresent = ded?.presentDays ?? 0;
      const duties = ded?.extraPayableDays ?? 0;
      const grossSalary = monthlySalary + Number(ded?.extraPayment || 0);
      const deductions = Number(ded?.lopAmount || 0);
      const netSalary = Number(ded?.netPayable || 0);
      const ruleDeductions = Number(ded?.ruleDeductions || 0);
      const ruleBonus = Number(ded?.ruleBonus || 0);
      const appliedRules = (ded?.ruleEffects || []).map((e: any) => e.ruleName).join('; ');

      return {
        'Employee Name': employeeName,
        'Employee ID': employeeId,
        'Designation': designation,
        'Monthly Salary': monthlySalary,
        'Days Present': daysPresent,
        'Duties': duties,
        'Gross Salary': grossSalary,
        'Deductions': deductions,
        'Rule Deductions': ruleDeductions,
        'Rule Bonus': ruleBonus,
        'Applied Rules': appliedRules,
        'Net Salary': netSalary
      };
    });
  };

  const exportSalarySheet = () => {
    // Include all filtered employees (what user is viewing) PLUS all employees with net salary > 0
    const netSalaryEmployeeIds = new Set(
      rows.filter(row => Number(row.deduction?.netPayable || 0) > 0).map(row => row.emp.id)
    );

    // Combine filtered rows with any net salary employees not already included
    const exportRowsSet = new Map([...filteredRows, ...rows.filter(row => netSalaryEmployeeIds.has(row.emp.id))].map(row => [row.emp.id, row]));
    const exportRows = Array.from(exportRowsSet.values());

    const transformedData = transformSalaryForExport(exportRows);

    if (transformedData.length === 0) {
      showToast('No data available to export');
      return;
    }

    const worksheet = XLSX.utils.json_to_sheet(transformedData);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Salary Sheet');

    const timestamp = format(new Date(), 'yyyyMMdd_HHmmss');
    const filename = `Salary_Sheet_With_Employee_ID_${timestamp}.csv`;
    XLSX.writeFile(workbook, filename);

    showToast(`Exported ${transformedData.length} employees to ${filename}`);
  };

  return (
    <div className="w-full min-w-0 bg-gradient-to-br from-slate-50 to-slate-100 px-3 py-4 sm:p-6">
      <div className="mb-4 flex flex-row items-center justify-between gap-2 sm:gap-3">
        <div className="min-w-0">
          <div className="flex min-w-0 items-center gap-3">
            <div className="hidden h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-purple-500 to-indigo-600 text-white shadow-lg shadow-purple-500/30 sm:flex sm:h-12 sm:w-12 sm:rounded-2xl">
              <span className="material-icons text-xl sm:text-2xl">payments</span>
            </div>
            <h1 className="min-w-0 text-2xl font-bold leading-tight text-slate-800 sm:text-3xl">Salary &amp; Loss of Pay</h1>
          </div>
          <p className="mt-2 hidden text-xs leading-relaxed text-slate-500 sm:ml-14 sm:block sm:text-sm">Salary is calculated automatically from Employee Master and attendance records.</p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <button
            onClick={exportSalarySheet}
            className="flex items-center gap-1.5 rounded-lg border border-slate-300 px-2.5 py-2 text-[11px] font-medium text-slate-600 transition-colors hover:bg-slate-50 sm:gap-2 sm:px-3 sm:text-xs"
          >
            <span className="material-icons text-sm">download</span>
            Export
          </button>
          <button
            onClick={() => setShowPrintOptions(true)}
            className="hidden items-center gap-2 rounded-lg border border-slate-300 px-3 py-2 text-xs font-medium text-slate-600 transition-colors hover:bg-slate-50 sm:flex"
          >
            <span className="material-icons text-sm">print</span>
            Print Salary Sheet
          </button>
        </div>
      </div>

      {/* <SalaryStatsGrid summary={summary} /> */}

      {/* Payroll Summary Bar */}
      {/* <PayrollSummaryBar
        totalPayroll={summary.totalPayroll}
        netPayable={summary.netPayable}
        totalExtraPay={summary.totalExtraPay}
        totalLopAmount={summary.totalLopAmount}
      /> */}

      <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden shadow-lg shadow-slate-200/50">
        <div className="flex flex-row items-center gap-1 border-b border-slate-200 bg-gradient-to-br from-slate-50 to-white p-2 sm:flex-row sm:justify-between sm:gap-3 sm:p-3">
          <div className="flex min-w-0 flex-1 items-center gap-1 sm:max-w-sm sm:gap-2">
            <div className="relative min-w-0 flex-1">
            <span className="material-icons pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-lg text-slate-400">search</span>
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search employee name, email or ID..."
              className="w-full rounded-lg border border-slate-300 bg-white py-2 pl-8 pr-1 text-[10px] outline-none focus:border-purple-500 focus:ring-2 focus:ring-purple-500/20 transition-all shadow-sm sm:rounded-xl sm:py-2 sm:pl-12 sm:pr-4 sm:text-sm"
            />
            </div>
            <div className="relative w-[64px] shrink-0 sm:hidden">
              <select
                value={filter}
                onChange={e => setFilter(e.target.value)}
                className="!min-w-0 !w-full h-9 appearance-none rounded-lg border border-slate-300 bg-white py-1 pl-1 pr-4 text-[8px] font-semibold text-slate-700 outline-none focus:border-purple-500 focus:ring-2 focus:ring-purple-500/20 sm:h-auto sm:w-auto sm:rounded-xl sm:py-2 sm:pl-4 sm:pr-12 sm:text-sm"
              >
                <option value="attendance">All Employees</option>
                <option value="all">All Employees</option>
                <option value="missing-attendance">Missing Attendance</option>
                <option value="lop">Has Loss of Pay</option>
                <option value="missing-salary">Missing Salary</option>
                <option value="payable">Net Payable &gt; 0</option>
              </select>
              <span className="material-icons pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-base text-slate-400">expand_more</span>
            </div>
          </div>
          <div className="flex shrink-0 flex-nowrap items-center gap-1 sm:flex-wrap sm:gap-2">
            <div className="relative hidden shrink-0 sm:block">
              <select
                value={filter}
                onChange={e => setFilter(e.target.value)}
                className="!min-w-0 !w-[78px] appearance-none rounded-lg border border-slate-300 bg-white py-1.5 pl-1 pr-4 text-[8px] font-semibold text-slate-700 outline-none focus:border-purple-500 focus:ring-2 focus:ring-purple-500/20 transition-all cursor-pointer hover:border-purple-400 shadow-sm sm:w-auto sm:rounded-xl sm:py-2 sm:pl-4 sm:pr-12 sm:text-sm"
              >
                <option value="attendance">All Employees</option>
                <option value="all">All Employees</option>
                <option value="missing-attendance">Missing Attendance</option>
                <option value="lop">Has Loss of Pay</option>
                <option value="missing-salary">Missing Salary</option>
                <option value="payable">Net Payable &gt; 0</option>
              </select>
              <span className="material-icons pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-lg text-slate-400">expand_more</span>
            </div>
            <div className="relative w-[78px] shrink-0 sm:w-auto">
              <select
                value={companyFilter}
                onChange={e => setCompanyFilter(e.target.value)}
                className="!min-w-0 !w-full appearance-none rounded-lg border border-slate-300 bg-white py-1.5 pl-1 pr-4 text-[8px] font-semibold text-slate-700 outline-none focus:border-purple-500 focus:ring-2 focus:ring-purple-500/20 transition-all cursor-pointer hover:border-purple-400 shadow-sm sm:rounded-xl sm:py-2 sm:pl-4 sm:pr-12 sm:text-sm"
              >
                <option value="All">All Departments</option>
                <option value="Rafttar">Rafttar</option>
                <option value="Ayushman">Ayushman</option>
                <option value="Hope">Hope</option>
                <option value="IT">IT</option>
                <option value="Other">Other</option>
              </select>
              <span className="material-icons pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-lg text-slate-400">expand_more</span>
            </div>
            {hasActiveFilters && (
              <button
                onClick={clearFilters}
                className="flex h-9 w-8 items-center justify-center rounded-lg bg-gradient-to-r from-slate-100 to-slate-200 px-1 py-1.5 text-[9px] font-semibold text-slate-700 hover:from-slate-200 hover:to-slate-300 transition-all shadow-sm sm:h-auto sm:w-auto sm:gap-2 sm:rounded-xl sm:px-3 sm:py-2 sm:text-sm"
              >
                <span className="material-icons text-lg">close</span>
                <span className="hidden sm:inline">Clear Filters</span>
              </button>
            )}
          </div>
        </div>
        {noAttendanceData && (
          <div className="flex flex-wrap items-center gap-3 border-b border-amber-200 bg-gradient-to-r from-amber-50 to-orange-50 px-4 py-3 text-xs font-medium text-amber-800">
            <span className="material-icons text-lg">info</span>
            <span>No attendance records for {month}. Showing salary only — import an attendance file to calculate loss of pay, overtime and net payable.</span>
          </div>
        )}
        {hasActiveFilters && (
          <div className="flex flex-wrap items-center gap-3 border-b border-slate-100 bg-gradient-to-r from-slate-50 to-white px-5 py-3 text-sm text-slate-600">
            <span className="font-bold text-slate-700">Active filters:</span>
            {search.trim() && (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-gradient-to-r from-purple-100 to-indigo-100 px-3 py-1.5 text-sm font-semibold text-purple-700 shadow-sm">
                <span className="material-icons text-sm">search</span>
                {search.trim()}
              </span>
            )}
            {filter !== 'attendance' && (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-gradient-to-r from-emerald-100 to-green-100 px-3 py-1.5 text-sm font-semibold text-emerald-700 shadow-sm">
                {filter === 'missing-attendance' ? 'Missing Attendance' : filter === 'missing-salary' ? 'Missing Salary' : filter === 'lop' ? 'Has Loss of Pay' : filter === 'payable' ? 'Net Payable' : filter === 'all' ? 'All Employees' : 'With Attendance'}
              </span>
            )}
            {companyFilter !== 'All' && (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-gradient-to-r from-blue-100 to-indigo-100 px-3 py-1.5 text-sm font-semibold text-blue-700 shadow-sm">
                <span className="material-icons text-sm">business</span>
                {companyFilter}
              </span>
            )}
            {departmentPill !== 'All' && (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-gradient-to-r from-purple-100 to-pink-100 px-3 py-1.5 text-sm font-semibold text-purple-700 shadow-sm">
                <span className="material-icons text-sm">domain</span>
                {departmentPill}
              </span>
            )}
            <button
              onClick={clearFilters}
              className="ml-auto rounded-lg bg-slate-200 px-3 py-1.5 text-sm font-bold text-slate-700 hover:bg-slate-300 transition-colors"
            >
              Clear all
            </button>
          </div>
        )}

        {/* Department Quick Filter Pills - COMMENTED OUT */}
        {/* <div className="border-b border-slate-200 bg-gradient-to-br from-slate-50 to-white px-5 py-3">
          <DepartmentPillFilters
            selected={departmentPill}
            onSelect={setDepartmentPill}
          />
        </div> */}

        <div className="space-y-2 p-2 sm:hidden">
          {visibleRows.map(row => {
            const { emp, config: cfg, deduction: ded, hasAttendance, hasSalary } = row;
            const currentSalary = Number(cfg?.basicSalary || 0);
            const liveExtraPayment = ded ? Number(ded.extraPayment || 0) : 0;
            return (
              <article key={emp.id} onClick={() => setDrawerEmployee(row)} className="cursor-pointer rounded-xl border border-slate-200 bg-white p-2.5 shadow-sm transition-shadow hover:shadow-md">
                <div className="flex items-start gap-2.5">
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-purple-500 to-indigo-600 text-xs font-bold text-white shadow-sm">
                    {emp.name ? emp.name.split(' ').map((n: string) => n[0]).join('').substring(0, 2).toUpperCase() : 'NA'}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0"><p className="truncate text-xs font-bold text-slate-800">{emp.name}</p><p className="truncate text-[10px] text-slate-500">{emp.email || 'No email'}</p></div>
                      <p className="shrink-0 text-xs font-bold text-slate-700">{currentSalary > 0 ? formatINR(currentSalary) : '—'}</p>
                    </div>
                    <div className="mt-1.5 flex flex-nowrap items-center gap-1.5 overflow-x-auto whitespace-nowrap text-[9px]">
                      <span className={`shrink-0 rounded-full px-1.5 py-0.5 font-bold uppercase ${!hasAttendance ? 'bg-slate-100 text-slate-500' : ded?.lopAmount ? 'bg-red-50 text-red-600' : liveExtraPayment > 0 ? 'bg-blue-50 text-blue-600' : hasSalary ? 'bg-emerald-50 text-emerald-600' : 'bg-amber-50 text-amber-600'}`}>{!hasAttendance ? 'No attendance' : liveExtraPayment > 0 ? 'Extra pay' : ded?.lopAmount ? 'LOP' : hasSalary ? 'Loaded' : 'Pending'}</span>
                      {ded && <><span className="shrink-0 rounded bg-emerald-50 px-1.5 py-0.5 text-emerald-700">Present {Number(ded.presentDays || 0).toFixed(Number(ded.presentDays || 0) % 1 ? 1 : 0)}</span><span className="shrink-0 rounded bg-slate-100 px-1.5 py-0.5 text-slate-600">Payable {Number(ded.payableDays || 0).toFixed(Number(ded.payableDays || 0) % 1 ? 1 : 0)}</span></>}
                    </div>
                  </div>
                </div>
              </article>
            );
          })}
        </div>

        {/* A fade on the right edge whenever the table is wider than its box, so a
            column pushed off-screen is visible rather than silently cut off. */}
        <div className="relative hidden sm:block">
        <div className="w-full overflow-x-auto pb-2 scrollbar-thin scrollbar-thumb-slate-300 scrollbar-track-slate-100 hover:scrollbar-thumb-slate-400">
        <table className="w-full table-auto text-xs md:text-sm tabular-nums">
          <thead>
            <tr className="bg-gradient-to-r from-slate-50 to-slate-100 border-b-2 border-slate-200">
              <th className="z-10 min-w-[200px] bg-gradient-to-br from-slate-50 to-slate-100 px-3 py-2.5 text-left font-bold text-slate-700 text-xs md:text-sm md:sticky md:left-0 md:shadow-[4px_0_8px_-6px_rgba(15,23,42,0.35)]">Employee</th>
              <th className="min-w-[100px] px-2 py-2 md:px-3 md:py-3 text-right font-bold text-xs md:text-sm text-slate-700">Salary<br />(₹)</th>
              <th className="min-w-[90px] px-2 py-2 md:px-3 md:py-3 text-right font-bold text-xs md:text-sm text-emerald-700">Present<br />Days</th>
              <th className="min-w-[90px] px-2 py-2 md:px-3 md:py-3 text-right font-bold text-xs md:text-sm text-emerald-700">Payable<br />Days</th>
              <th className="hidden sm:table-cell min-w-[90px] px-2 py-2 md:px-3 md:py-3 text-right font-bold text-xs md:text-sm text-slate-700">Absent<br />Days</th>
              <th className="hidden lg:table-cell min-w-[80px] px-2 py-2 md:px-3 md:py-3 text-right font-bold text-xs md:text-sm text-slate-700">Half<br />Days</th>
              <th className="hidden md:table-cell min-w-[80px] px-2 py-2 md:px-3 md:py-3 text-right font-bold text-xs md:text-sm text-slate-700">Late<br />Count</th>
              <th className="hidden md:table-cell min-w-[90px] px-2 py-2 md:px-3 md:py-3 text-right font-bold text-xs md:text-sm text-slate-700">Paid<br />Leave</th>
              <th className="hidden sm:table-cell min-w-[110px] px-2 py-2 md:px-3 md:py-3 text-right font-bold text-xs md:text-sm text-slate-700">Loss of Pay<br />Days</th>
              <th className="min-w-[100px] px-2 py-2 md:px-3 md:py-3 text-right font-bold text-xs md:text-sm text-red-600">LOP<br />Amt</th>
              <th className="min-w-[90px] px-2 py-2 md:px-3 md:py-3 text-right font-bold text-xs md:text-sm text-emerald-700">Extra<br />Days</th>
              <th className="hidden sm:table-cell min-w-[110px] px-2 py-2 md:px-3 md:py-3 text-right font-bold text-xs md:text-sm text-emerald-700">Extra Pay<br />Amount</th>
              <th className="hidden md:table-cell min-w-[130px] px-2 py-2 md:px-3 md:py-3 text-right font-bold text-xs md:text-sm text-indigo-700">Rule<br />Adjustments</th>
              <th className="hidden md:table-cell min-w-[120px] px-2 py-2 md:px-3 md:py-3 text-right font-bold text-xs md:text-sm text-blue-700">Management<br />Decision</th>
              <th className="min-w-[110px] px-2 py-2 md:px-3 md:py-3 text-right font-bold text-xs md:text-sm text-emerald-700">Net<br />Payable</th>
            </tr>
          </thead>
          <tbody>
            {visibleRows.map(row => {
              const { emp, config: cfg, deduction: ded, hasAttendance, hasSalary } = row;
              const currentSalary = Number(cfg?.basicSalary || 0);
              const liveLopAmount = ded ? Number(ded.lopAmount || 0) : null;
              const liveExtraPayment = ded ? Number(ded.extraPayment || 0) : 0;
              // Read, never recomputed — the engine counts the payable days and
              // owns the formula, and every screen has to tell the same story.
              const netPayable = ded && currentSalary > 0 ? Number(ded.netPayable || 0) : null;
              // A month whose import is short of dates cannot be paid in full,
              // because a day nobody recorded is a day nobody is paid for.
              const daysMissing = ded ? Math.max(0, Number(ded.daysInMonth || 0) - Number(ded.daysCovered || 0)) : 0;
              return (
                <tr key={emp.id} className="border-b border-slate-100 hover:bg-gradient-to-r hover:from-purple-50/40 hover:to-indigo-50/40 transition-all">
                  <td className="z-[1] min-w-[180px] max-w-0 overflow-hidden bg-white px-3 py-2.5 md:sticky md:left-0 md:shadow-[4px_0_8px_-6px_rgba(15,23,42,0.35)]">
                    <div onClick={() => setDrawerEmployee(row)} className="flex w-full items-start gap-2.5 text-left group cursor-pointer" title="View employee details">
                      <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-purple-500 to-indigo-600 text-white text-xs font-bold shadow-md ring-2 ring-purple-100">
                        {emp.name ? emp.name.split(' ').map((n: string) => n[0]).join('').substring(0, 2).toUpperCase() : 'NA'}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <p className="break-words font-bold text-sm leading-tight text-slate-800 group-hover:text-purple-700 transition-colors" title={emp.name}>{emp.name}</p>
                          <button
                            type="button"
                            onClick={(e) => { e.stopPropagation(); openAttendance(row); }}
                            className="p-1 hover:bg-purple-50 rounded-full transition-colors"
                            title="View attendance details"
                          >
                            <span className="material-icons text-sm text-purple-600">calendar_today</span>
                          </button>
                        </div>
                        {emp.email && <p className="break-all text-xs leading-tight text-slate-500 truncate" title={emp.email}>{emp.email}</p>}
                        <span className={`mt-1 sm:mt-2 inline-flex items-center gap-0.5 sm:gap-1.5 rounded-full px-1.5 sm:px-2.5 py-0.5 sm:py-1 text-[8px] sm:text-[10px] font-bold uppercase tracking-wide ${!hasAttendance ? 'bg-slate-100 text-slate-500' : ded?.lopAmount ? 'bg-gradient-to-r from-red-50 to-rose-50 text-red-600 ring-1 ring-red-100' : liveExtraPayment > 0 ? 'bg-gradient-to-r from-blue-50 to-indigo-50 text-blue-600 ring-1 ring-blue-100' : hasSalary ? 'bg-gradient-to-r from-emerald-50 to-green-50 text-emerald-600 ring-1 ring-emerald-100' : 'bg-gradient-to-r from-amber-50 to-orange-50 text-amber-600 ring-1 ring-amber-100'}`}>
                          {!hasAttendance ? 'No att' : liveExtraPayment > 0 ? 'Extra pay' : ded?.lopAmount ? 'LOP' : hasSalary ? 'Loaded' : 'Pending'}
                        </span>
                      </div>
                    </div>
                  </td>
                  <td className="whitespace-nowrap px-2 py-2 md:px-3 md:py-3 text-right">
                    <p className="font-bold text-slate-700 text-xs md:text-sm">{currentSalary > 0 ? formatINR(currentSalary) : '—'}</p>
                    {!hasSalary && <p className="mt-0.5 sm:mt-1 text-[8px] sm:text-[10px] font-bold text-amber-600 hidden sm:block">Missing salary</p>}
                  </td>
                  <td className="whitespace-nowrap px-2 py-2 md:px-3 md:py-3 text-right font-bold text-xs md:text-sm text-emerald-700"><button type="button" onClick={() => openAttendance(row, { statuses: ['Normal', 'Missed Swipe', 'Late Coming', 'Early Leaving'], label: 'Present Dates', includeSundays: ded?.rafttarStaff === true, note: 'A long shift counts as more than one day and a short one as half, so the days credited need not equal the number of dates listed.' })} className="rounded-lg px-1 sm:px-1.5 md:px-2 py-1 sm:py-1.5 hover:bg-emerald-50 hover:underline font-bold transition-all text-xs md:text-sm" title="View the dates this employee was present">{ded ? Number(ded.presentDays || 0).toFixed(Number(ded.presentDays || 0) % 1 ? 1 : 0) : '—'}</button></td>
                  <td className="whitespace-nowrap px-2 py-2 md:px-3 md:py-3 text-right font-bold text-xs md:text-sm text-emerald-700" title={ded ? `${Number(ded.attendedDays || 0)} attended + ${Number(ded.paidOffDays || 0)} paid off, of ${ded.daysInMonth} days` : undefined}>
                    <span className="font-bold">{ded ? Number(ded.payableDays || 0).toFixed(Number(ded.payableDays || 0) % 1 ? 1 : 0) : '—'}</span>
                    {daysMissing > 0 && (
                      <p className="mt-0.5 sm:mt-1 text-[8px] sm:text-[10px] font-bold text-amber-600" title={`${daysMissing} date${daysMissing === 1 ? '' : 's'} of this month were never imported, so they cannot be paid for. Re-import the month before paying.`}>
                        {daysMissing} missing
                      </p>
                    )}
                  </td>
                  <td className="hidden sm:table-cell whitespace-nowrap px-2 py-2 md:px-3 md:py-3 text-right text-slate-600 text-xs md:text-sm">
                    {ded && Number(ded.absentDays || 0) > 0 ? (
                      <button
                        type="button"
                        onClick={() => openAttendance(row, { statuses: ['Absent'], label: 'Absent Dates', skipProtected: true, protectedCount: ded.protectedAbsentDays || 0 })}
                        className="rounded-lg px-1 sm:px-1.5 md:px-2 py-1 sm:py-1.5 font-bold text-red-600 hover:bg-red-50 hover:underline transition-all text-xs md:text-sm"
                        title="View the dates this employee was absent (unpaid beyond allowance)"
                      >
                        {ded.absentDays}
                      </button>
                    ) : (ded?.absentDays ?? '—')}
                  </td>
                  <td className="hidden lg:table-cell whitespace-nowrap px-2 py-2 md:px-3 md:py-3 text-right text-slate-600 text-xs md:text-sm">
                    {ded && Number(ded.halfDays || 0) > 0 ? (
                      <button
                        type="button"
                        onClick={() => openAttendance(row, { statuses: ['HALF_DAY'], label: 'Half-Day Dates', note: 'Days with less than half the shift hours worked. Half pay is deducted for these days.' })}
                        className="rounded-lg px-1 sm:px-1.5 md:px-2 py-1 sm:py-1.5 font-bold text-slate-600 hover:bg-amber-50 hover:underline transition-all text-xs md:text-sm"
                        title="View half-day dates"
                      >
                        {ded.halfDays}
                      </button>
                    ) : (ded?.halfDays ?? '—')}
                  </td>
                  <td className="hidden md:table-cell whitespace-nowrap px-2 py-2 md:px-3 md:py-3 text-right text-slate-600 text-xs md:text-sm">
                    {ded && Number(ded.lateOccurrences || 0) > 0 ? (
                      <button
                        type="button"
                        onClick={() => openAttendance(row, { statuses: ['Late Coming', 'LATE'], label: 'Late Coming Dates', note: 'Days with arrival after the grace period. 4-6 late days/month = 0.5 day LOP, 7+ days = 1 day LOP.' })}
                        className="rounded-lg px-1 sm:px-1.5 md:px-2 py-1 sm:py-1.5 font-bold text-slate-600 hover:bg-orange-50 hover:underline transition-all text-xs md:text-sm"
                        title="View late coming dates"
                      >
                        {ded.lateOccurrences}
                      </button>
                    ) : (ded?.lateOccurrences ?? '—')}
                  </td>
                  <td className="hidden md:table-cell whitespace-nowrap px-2 py-2 md:px-3 md:py-3 text-right text-slate-600 text-xs md:text-sm">
                    {ded && Number(ded.protectedAbsentDays || 0) > 0 ? (
                      <button
                        type="button"
                        onClick={() => openAttendance(row, { statuses: ['Absent'], label: 'Paid Leave Dates', note: 'Paid leave days taken. These are covered by the monthly leave allowance.', showProtectedOnly: true, protectedCount: ded.protectedAbsentDays || 0 })}
                        className="rounded-lg px-1 sm:px-1.5 md:px-2 py-1 sm:py-1.5 font-bold text-slate-600 hover:bg-green-50 hover:underline transition-all text-xs md:text-sm"
                        title="View paid leave dates"
                      >
                        {ded.protectedAbsentDays}/{ded.leaveLimit}
                      </button>
                    ) : (ded?.leaveLimit ? `0/${ded.leaveLimit}` : '—')}
                  </td>
                  <td className="hidden sm:table-cell whitespace-nowrap px-2 py-2 md:px-3 md:py-3 text-right text-slate-600 font-bold text-xs md:text-sm">{ded?.lopDays ? ded.lopDays.toFixed(1) : '—'}</td>
                  <td className="whitespace-nowrap px-2 py-2 md:px-3 md:py-3 text-right font-bold text-xs md:text-sm text-red-600">
                    {ded && Number(ded.lopAmount || 0) > 0 ? (
                      <button type="button" onClick={() => setLopExplain({ ded, emp, row, salary: currentSalary })}
                        className="rounded-lg px-1 sm:px-1.5 md:px-2 py-1 sm:py-1.5 underline decoration-dotted underline-offset-2 hover:bg-red-50 font-bold transition-all text-xs md:text-sm"
                        title="Show why this amount was cut">{formatINR(liveLopAmount || 0)}</button>
                    ) : liveLopAmount !== null ? formatINR(liveLopAmount) : Number(currentSalary) > 0 ? '₹0' : '—'}
                  </td>
                  <td className="whitespace-nowrap px-2 py-2 md:px-3 md:py-3 text-right font-bold text-xs md:text-sm text-emerald-700"
                    title={ded ? `${Number(ded.workedWeeklyOffs || 0)} weekly off(s) worked + ${Number(ded.unusedLeaveDays || 0)} leave day(s) not availed` : undefined}>
                    {ded && Number(ded.extraPayableDays || 0) > 0 ? (
                      <button
                        type="button"
                        onClick={() => openAttendance(row, {
                          statuses: ['Normal', 'Missed Swipe', 'Late Coming', 'Early Leaving', 'HALF_DAY'],
                          label: 'Extra Pay Dates',
                          note: 'Dates with overtime shifts (1.5x or 2x credit) or extra pay. Shows only days where credit earned was >= 1.5 days.',
                          filterMinCredit: 1.5
                        })}
                        className="rounded-lg px-1 sm:px-1.5 md:px-2 py-1 sm:py-1.5 font-bold text-emerald-700 hover:bg-emerald-50 hover:underline transition-all text-xs md:text-sm"
                        title="View extra pay dates"
                      >
                        {Number(ded.extraPayableDays).toFixed(Number(ded.extraPayableDays) % 1 ? 1 : 0)}
                      </button>
                    ) : ded ? <span className="font-bold">0</span> : '—'}
                  </td>
                  <td className="hidden sm:table-cell whitespace-nowrap px-2 py-2 md:px-3 md:py-3 text-right font-bold text-xs md:text-sm text-emerald-700">
                    {ded && liveExtraPayment > 0 ? (
                      <button type="button" onClick={() => setLopExplain({ ded, emp, row, salary: currentSalary })}
                        className="rounded-lg px-1 sm:px-1.5 md:px-2 py-1 sm:py-1.5 underline decoration-dotted underline-offset-2 hover:bg-emerald-50 font-bold transition-all text-xs md:text-sm"
                        title="Show why this amount was added">{formatINR(liveExtraPayment)}</button>
                    ) : ded ? <span className="font-bold">₹0</span> : '—'}
                  </td>
                  <td className="hidden md:table-cell whitespace-nowrap px-2 py-2 md:px-3 md:py-3 text-right">
                    {ded && (ded.ruleEffects?.length || ded.ruleDeductions || ded.ruleBonus) ? (
                      <button
                        type="button"
                        onClick={() => setCalculationDetailsRow(row)}
                        className="inline-flex flex-col items-end gap-0.5 rounded-lg px-1 sm:px-1.5 md:px-2 py-1 sm:py-1.5 hover:bg-indigo-50 transition-all"
                        title={(ded.ruleEffects || []).map((e: any) => e.description).join('\n') || 'Rules Engine adjustments'}
                      >
                        {Number(ded.ruleDeductions || 0) > 0 && (
                          <span className="font-bold text-xs md:text-sm text-red-600">-{formatINR(ded.ruleDeductions)}</span>
                        )}
                        {Number(ded.ruleBonus || 0) > 0 && (
                          <span className="font-bold text-xs md:text-sm text-emerald-600">+{formatINR(ded.ruleBonus)}</span>
                        )}
                        <span className="text-[8px] sm:text-[10px] font-semibold text-indigo-500">
                          {(ded.ruleEffects || []).length} rule{(ded.ruleEffects || []).length === 1 ? '' : 's'}
                        </span>
                      </button>
                    ) : ded ? <span className="text-slate-400">—</span> : '—'}
                  </td>
                  <td className="hidden md:table-cell whitespace-nowrap px-2 py-2 md:px-3 md:py-3 text-right">
                    <button
                      type="button"
                      onClick={() => setManagementAdjustmentRow(row)}
                      className={`rounded-lg px-1 sm:px-1.5 md:px-2 py-1 sm:py-1.5 font-bold hover:bg-blue-50 hover:underline transition-all text-xs md:text-sm ${
                        ded?.managementAdjustment
                          ? ded.managementAdjustment > 0
                            ? 'text-emerald-600 underline decoration-dotted underline-offset-2'
                            : 'text-red-600 underline decoration-dotted underline-offset-2'
                          : 'text-blue-600'
                      }`}
                      title={ded?.managementAdjustment ? `Management adjustment: ${ded.managementAdjustmentRemarks || 'No remarks'}` : 'Add management adjustment'}
                    >
                      {ded?.managementAdjustment ? formatINR(ded.managementAdjustment) : '—'}
                    </button>
                    {ded?.managementAdjustmentRemarks && (
                      <p className="mt-0.5 sm:mt-1 text-[8px] sm:text-[10px] text-slate-500 truncate max-w-[60px] sm:max-w-[120px]" title={ded.managementAdjustmentRemarks}>
                        {ded.managementAdjustmentRemarks}
                      </p>
                    )}
                  </td>
                  <td className="whitespace-nowrap px-2 py-2 md:px-3 md:py-3 text-right font-black text-emerald-700 text-xs md:text-sm">
                    {netPayable !== null ? (
                      <button
                        onClick={() => setCalculationDetailsRow(row)}
                        className="rounded-lg px-1 sm:px-1.5 md:px-2 py-1 sm:py-1.5 hover:bg-emerald-50 hover:underline transition-all text-xs md:text-sm"
                        title="View detailed calculation breakdown"
                      >
                        {formatINR(netPayable)}
                      </button>
                    ) : '—'}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        </div>
        <div className="pointer-events-none absolute inset-y-0 right-0 w-8 bg-gradient-to-l from-white via-white/80 to-transparent md:hidden"></div>
        </div>
        {filteredRows.length > 0 && (
          <TablePagination total={filteredRows.length} page={page} pageSize={PAGE_SIZE} onPageChange={setPage} noun="employees" />
        )}
        {filteredRows.length === 0 && (
          <div className="text-center py-20">
            <div className="mx-auto mb-5 flex h-20 w-20 items-center justify-center rounded-full bg-gradient-to-br from-slate-100 to-slate-200">
              <span className="material-icons text-4xl text-slate-400">search_off</span>
            </div>
            <p className="text-slate-600 font-semibold text-lg">{rows.length === 0 ? 'No employees found. Upload an attendance file first.' : hasActiveFilters ? 'No employees match all selected filters. Try clearing one filter.' : 'No employees match this search or filter.'}</p>
            {hasActiveFilters && rows.length > 0 && <button onClick={clearFilters} className="mt-5 rounded-xl bg-gradient-to-r from-purple-50 to-indigo-50 px-5 py-3 text-sm font-bold text-purple-700 hover:from-purple-100 hover:to-indigo-100 transition-all shadow-md ring-1 ring-purple-200">Clear all filters</button>}
          </div>
        )}
      </div>

      {toast && (
        <div className="fixed bottom-6 right-6 z-50 bg-gradient-to-r from-emerald-600 to-green-600 text-white text-sm font-semibold px-5 py-3.5 rounded-xl shadow-xl shadow-emerald-500/30">
          {toast}
        </div>
      )}

      {showPrintOptions && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-2xl border border-slate-200">
            <h2 className="text-xl font-bold bg-gradient-to-r from-slate-800 to-slate-600 bg-clip-text text-transparent">Print salary sheet</h2>
            <p className="mt-2 text-sm text-slate-500">Only employees with salary and Net Payable will be printed.</p>
            <div className="mt-5 space-y-4">
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-2 uppercase tracking-wide">Select Month</label>
                <input type="month" value={month} onChange={e => { monthWasSelected.current = true; setMonth(e.target.value); }} className="w-full rounded-xl border border-slate-300 px-4 py-3 text-sm focus:border-purple-500 focus:ring-2 focus:ring-purple-500/20 outline-none shadow-sm" />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-2 uppercase tracking-wide">Select Company</label>
                <div className="space-y-2">
                  {['All', 'Ayushman', 'Hope', 'Rafttar', 'IT', 'Other'].map(company => (
                    <button key={company} onClick={() => printSalarySheet(company)} className="flex w-full items-center justify-between rounded-xl border border-slate-300 px-4 py-3 text-left text-sm font-semibold text-slate-700 hover:border-purple-400 hover:bg-gradient-to-r hover:from-purple-50 hover:to-indigo-50 transition-all shadow-sm hover:shadow-md">
                      {company === 'All' ? 'All companies' : company}
                      <span className="material-icons text-lg text-slate-400">print</span>
                    </button>
                  ))}
                </div>
              </div>
            </div>
            <button onClick={() => setShowPrintOptions(false)} className="mt-5 w-full rounded-xl border border-slate-300 py-3 text-sm font-semibold text-slate-600 hover:bg-slate-100 transition-colors">Cancel</button>
          </div>
        </div>
      )}

      {lopExplain && (
        <LopBreakdown
          ded={lopExplain.ded}
          emp={lopExplain.emp}
          salary={lopExplain.salary}
          month={month}
          uploadId={latestUpload?.id ?? null}
          onClose={() => setLopExplain(null)}
          onSeeDates={() => { const row = lopExplain.row; const ded = lopExplain.ded; setLopExplain(null); openAttendance(row, { statuses: ['Absent'], label: 'Absent Dates', skipProtected: true, protectedCount: ded?.protectedAbsentDays || 0 }); }}
        />
      )}

      {attendanceRow && latestUpload?.id && (
        <EmailDraftModal
          uploadId={latestUpload.id}
          employeeId={attendanceRow.emp.id}
          employeeName={attendanceRow.emp.name || ''}
          employeeEmail={attendanceRow.emp.email || ''}
          initialTab="records"
          recordsOnly
          filterStatuses={attendanceFilter?.statuses}
          filterLabel={attendanceFilter?.label}
          includeSundays={attendanceFilter?.includeSundays}
          filterNote={attendanceFilter?.note}
          filterMinCredit={attendanceFilter?.filterMinCredit}
          deduction={attendanceRow.deduction}
          employee={attendanceRow.emp}
          monthlySalary={Number(attendanceRow.config?.basicSalary || 0)}
          onClose={() => { setAttendanceRow(null); setAttendanceFilter(null); }}
          onSent={() => { setAttendanceRow(null); setAttendanceFilter(null); }}
        />
      )}

      {managementAdjustmentRow && (
        <ManagementAdjustmentModal
          uploadId={latestUpload?.id || null}
          employeeId={managementAdjustmentRow.emp.id}
          employeeName={managementAdjustmentRow.emp.name || ''}
          currentAdjustment={managementAdjustmentRow.deduction?.managementAdjustment || 0}
          currentRemarks={managementAdjustmentRow.deduction?.managementAdjustmentRemarks || ''}
          onClose={() => setManagementAdjustmentRow(null)}
          onSave={() => {
            setManagementAdjustmentRow(null);
            qc.invalidateQueries({ queryKey: ['all-management-adjustments'] });
            if (latestUpload?.id) {
              qc.invalidateQueries({ queryKey: ['deductions', latestUpload.id] });
            }
          }}
        />
      )}

      {calculationDetailsRow && (
        <CalculationDetailsModal
          isOpen={!!calculationDetailsRow}
          onClose={() => setCalculationDetailsRow(null)}
          employeeName={calculationDetailsRow.emp.name || ''}
          employeeId={calculationDetailsRow.emp.employee_number || calculationDetailsRow.emp.employeeNumber || calculationDetailsRow.emp.employeeId || calculationDetailsRow.emp.id || '-'}
          designation={calculationDetailsRow.emp.designation}
          basicSalary={Number(calculationDetailsRow.config?.basicSalary || 0)}
          extraPayableDays={calculationDetailsRow.deduction?.extraPayableDays}
          extraPaymentAmount={calculationDetailsRow.deduction?.extraPayment}
          lopAmount={calculationDetailsRow.deduction?.lopAmount}
          managementAdjustment={calculationDetailsRow.deduction?.managementAdjustment}
          managementAdjustmentRemarks={calculationDetailsRow.deduction?.managementAdjustmentRemarks}
          ruleEffects={calculationDetailsRow.deduction?.ruleEffects}
          netPayable={Number(calculationDetailsRow.deduction?.netPayable || 0)}
          perDaySalary={calculationDetailsRow.config?.basicSalary && calculationDetailsRow.deduction?.daysInMonth ? Number(calculationDetailsRow.config.basicSalary) / Number(calculationDetailsRow.deduction.daysInMonth) : undefined}
          daysPresent={calculationDetailsRow.deduction?.presentDays}
          totalDays={calculationDetailsRow.deduction?.daysInMonth}
        />
      )}

      {/* Employee Drawer */}
      <EmployeeDrawer
        isOpen={!!drawerEmployee}
        onClose={() => setDrawerEmployee(null)}
        onOpenAttendance={(filter) => {
          const row = drawerEmployee;
          if (!row) return;
          setDrawerEmployee(null);
          openAttendance(row, filter);
        }}
        onOpenLop={() => {
          if (!drawerEmployee) return;
          const row = drawerEmployee;
          setDrawerEmployee(null);
          setLopExplain({ ded: row.deduction, emp: row.emp, row, salary: Number(row.config?.basicSalary || 0) });
        }}
        onOpenCalculation={() => {
          if (!drawerEmployee) return;
          const row = drawerEmployee;
          setDrawerEmployee(null);
          setCalculationDetailsRow(row);
        }}
        onOpenManagement={() => {
          if (!drawerEmployee || user?.role !== 'admin') return;
          const row = drawerEmployee;
          setDrawerEmployee(null);
          setManagementAdjustmentRow(row);
        }}
        onOpenExtraPay={() => {
          if (!drawerEmployee) return;
          const row = drawerEmployee;
          setDrawerEmployee(null);
          setLopExplain({ ded: row.deduction, emp: row.emp, row, salary: Number(row.config?.basicSalary || 0) });
        }}
        canEditManagement={user?.role === 'admin'}
        employee={drawerEmployee}
        month={month}
      />
    </div>
  );
}
