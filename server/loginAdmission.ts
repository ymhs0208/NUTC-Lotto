import { BoundedExecutor } from './resourceLimits';

// Admit the exhibition's 600-student burst while keeping active database/CPU work bounded.
export const STUDENT_LOGIN_LIMITS = { concurrency: 16, maxWaiting: 768, waitMs: 120000 } as const;
export const studentLoginWork = new BoundedExecutor(
  STUDENT_LOGIN_LIMITS.concurrency, STUDENT_LOGIN_LIMITS.maxWaiting, STUDENT_LOGIN_LIMITS.waitMs,
);
export const staffLoginWork = new BoundedExecutor(2, 8, 3000);
