/** Default number of consume calls for one account allowed in flight in this process. */
export const DEFAULT_ACCOUNT_CONCURRENCY = 2;

type Slot = { active: number; readonly waiting: (() => void)[] };

export type KeyedLimiter = {
  // Runs `task` once fewer than `limit` tasks for `key` are running. Tasks start in arrival order.
  readonly run: <T>(key: string, task: () => Promise<T>) => Promise<T>;
  // Number of keys that currently have running or waiting tasks (0 when idle).
  readonly size: () => number;
};

export const createKeyedLimiter = (limit: number): KeyedLimiter => {
  if (!Number.isInteger(limit) || limit < 1) {
    throw new RangeError(
      `The limit must be a whole number of at least 1, got ${String(limit)}`,
    );
  }
  const slots = new Map<string, Slot>();

  const acquire = (key: string): Promise<Slot> => {
    let slot = slots.get(key);
    if (slot === undefined) {
      slot = { active: 0, waiting: [] };
      slots.set(key, slot);
    }
    if (slot.active < limit) {
      slot.active += 1;
      return Promise.resolve(slot);
    }
    const queue = slot;
    return new Promise<Slot>((resolve) => {
      queue.waiting.push(() => {
        resolve(queue);
      });
    });
  };

  const release = (key: string, slot: Slot): void => {
    const next = slot.waiting.shift();
    if (next !== undefined) {
      next(); // hand this slot straight to the next waiter: `active` stays the same
      return;
    }
    slot.active -= 1;
    if (slot.active === 0) {
      slots.delete(key); // no memory kept for idle keys
    }
  };

  return {
    run: async <T>(key: string, task: () => Promise<T>): Promise<T> => {
      const slot = await acquire(key);
      try {
        return await task();
      } finally {
        release(key, slot);
      }
    },
    size: () => slots.size,
  };
};
