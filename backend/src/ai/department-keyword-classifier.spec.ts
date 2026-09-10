import { DepartmentKey } from '@ticket-platform/shared';
import { classifyByKeywords } from './department-keyword-classifier';

const DEPARTMENTS = [
  { id: 'dept-tech', key: DepartmentKey.TECH },
  { id: 'dept-sales', key: DepartmentKey.SALES },
  { id: 'dept-hr', key: DepartmentKey.HR },
];

describe('classifyByKeywords', () => {
  it('matches a department whose keyword appears in the subject', () => {
    const result = classifyByKeywords('VPN keeps disconnecting', 'Happens every morning', DEPARTMENTS);
    expect(result?.departmentId).toBe('dept-tech');
  });

  it('matches a department whose keyword appears in the description, case-insensitively', () => {
    const result = classifyByKeywords('Question', 'Need help with my PAYROLL deduction', DEPARTMENTS);
    expect(result?.departmentId).toBe('dept-hr');
  });

  it('returns null when nothing matches, leaving it to the AI fallback', () => {
    expect(classifyByKeywords('Hello', 'Just saying hi', DEPARTMENTS)).toBeNull();
  });

  it('only considers departments actually passed in (e.g. active-only)', () => {
    const result = classifyByKeywords('Need a quote for renewal', 'Pricing question', [DEPARTMENTS[0]]); // TECH only, no SALES
    expect(result).toBeNull();
  });
});
