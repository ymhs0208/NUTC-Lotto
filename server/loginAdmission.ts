import { BoundedExecutor } from './resourceLimits';

// Buffer a 1,000-student burst without increasing concurrent database/CPU work.
// This is an admission bound, not a guarantee of completion before the deadline.
export const STUDENT_LOGIN_LIMITS = { concurrency: 16, maxWaiting: 1024, waitMs: 120000 } as const;
export const studentLoginWork = new BoundedExecutor(
  STUDENT_LOGIN_LIMITS.concurrency, STUDENT_LOGIN_LIMITS.maxWaiting, STUDENT_LOGIN_LIMITS.waitMs,
);
export const staffLoginWork = new BoundedExecutor(2, 8, 3000);
