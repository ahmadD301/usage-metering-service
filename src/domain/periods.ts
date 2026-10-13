
import { pipe } from "../shared/pipe.js";

// Get the beginning of a UTC month. 
// October 13, 2026 -> October 1, 2026 at 00:00 UTC

export const startOfUtcMonth = (date: Date): Date => {
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth();

  return new Date(Date.UTC(year, month, 1));
};


// Get the beginning of a UTC day.
// October 13, 2026 at 15:30 UTC -> October 13, 2026 at 00:00 UTC
export const startOfUtcDay = (date: Date): Date => {
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth();
  const day = date.getUTCDate();

  return new Date(Date.UTC(year, month, day));
};


//Convert a date into a YYYY-MM-DD string.
// 2026-10-13T00:00:00.000Z -> "2026-10-13"
export const toPeriodKey = (periodStart: Date): string => {
  return periodStart.toISOString().slice(0, 10);
};


// Get the key for the UTC month.
export const monthPeriodKey = (date: Date): string => {
  return pipe(
    date,
    startOfUtcMonth,
    toPeriodKey,
  );
};


// Get the key for the UTC day.
export const dayPeriodKey = (date: Date): string => {
  return pipe(
    date,
    startOfUtcDay,
    toPeriodKey,
  );
};
