// Shared formatters for payroll components.
export const fmtINR = (n: number | null | undefined) =>
  (n == null || isNaN(n as number)) ? '—' : (n as number).toLocaleString('en-IN', { maximumFractionDigits: 0 });

export const fmtNum = (n: number | null | undefined, digits = 1) =>
  (n == null || isNaN(n as number)) ? '—' : (n as number).toLocaleString('en-IN', { maximumFractionDigits: digits });
