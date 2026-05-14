export interface Employee {
  id: number;
  employeeNumber: string | null;
  name: string;
  email: string;
  organisation: string | null;
  entity: string | null;
  createdAt: string;
}

export interface SalaryConfig {
  id: number;
  employeeId: number;
  employeeName: string;
  basicSalary: number;
  effectiveMonth: string;
}
