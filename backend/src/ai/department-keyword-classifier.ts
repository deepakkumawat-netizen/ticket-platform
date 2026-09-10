import { DepartmentKey } from '@ticket-platform/shared';

// v1, zero-cost first pass for AiService.classifyDepartment() — a static
// per-department keyword map, checked before any AI call. Deliberately not a
// DB-backed/admin-editable table yet: there's no real submission volume to
// tune it against. Promotable later to a `Department.routingKeywords
// String[]` column + admin UI without changing classifyDepartment's contract
// (it degrades to the AI fallback exactly the same way either way).
const DEFAULT_KEYWORDS: Record<string, string[]> = {
  [DepartmentKey.TECH]: ['password', 'login', 'bug', 'error', 'crash', 'laptop', 'vpn', 'wifi', 'server', 'not working', "can't access"],
  [DepartmentKey.SALES]: ['quote', 'invoice', 'pricing', 'discount', 'renewal', 'subscription', 'purchase'],
  [DepartmentKey.OPERATIONS]: ['delivery', 'logistics', 'vendor', 'shipment', 'schedule', 'facility'],
  [DepartmentKey.CONTENT]: ['blog', 'copy', 'creative', 'website content', 'design asset', 'brochure'],
  [DepartmentKey.HR]: ['leave', 'payroll', 'onboarding', 'benefits', 'attendance', 'harassment', 'policy'],
};

export type ClassifiableDepartment = { id: string; key: string };

/** Zero-AI-cost keyword match — returns the first department (in the order
 * given) whose keyword list has a hit in the subject+description, or null if
 * nothing matched. Case-insensitive, substring match (not tokenized) — good
 * enough for the common, obvious cases; anything subtler falls through to
 * the AI classifier in AiService.classifyDepartment(). */
export function classifyByKeywords(
  subject: string,
  description: string,
  active: ClassifiableDepartment[],
): { departmentId: string; reasoning: string } | null {
  const haystack = `${subject} ${description}`.toLowerCase();
  for (const dept of active) {
    const keywords = DEFAULT_KEYWORDS[dept.key];
    if (!keywords) continue;
    const hit = keywords.find((kw) => haystack.includes(kw));
    if (hit) {
      return { departmentId: dept.id, reasoning: `Matched keyword "${hit}" for ${dept.key}.` };
    }
  }
  return null;
}
