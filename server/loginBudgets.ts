export type LoginBudget = { key: string; limit: number };
export type LoginBucket = { count: number; resetAt: number };
export type LoginDecision = { success: boolean; retryAfter: number; challenge?: boolean };

// The final budget is always the account; campus students omit the preceding IP budget.
// No mutation on rejection. IP checks precede account risk checks.
export function decideLoginBudgets(budgets: LoginBudget[], stored: Map<string, LoginBucket>, now: number, windowMs: number, proof: boolean) {
  const current = budgets.map(b => {
    const value = stored.get(b.key);
    return value && value.resetAt > now ? value : { count: 0, resetAt: now + windowMs };
  });
  const accountIndex = budgets.length - 1;
  for (let i = 0; i < accountIndex; i++) {
    if (current[i].count >= budgets[i].limit) return { decision: { success: false, retryAfter: Math.ceil((current[i].resetAt - now) / 1000) } as LoginDecision };
  }
  if (!proof && current[accountIndex].count >= budgets[accountIndex].limit) return { decision: { success: false, retryAfter: 0, challenge: true } as LoginDecision };
  const updates = new Map(budgets.map((b, i) => [b.key, { count: Math.min(current[i].count + 1, b.limit), resetAt: current[i].resetAt }]));
  return { decision: { success: true, retryAfter: 0 } as LoginDecision, updates };
}
