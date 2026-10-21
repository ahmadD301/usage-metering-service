import { describe, expect, it } from "vitest";
import { createKeyedLimiter } from "./keyed-limiter.js";

const deferred = (): { promise: Promise<void>; resolve: () => void } => {
  let resolve: () => void = () => undefined;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
};

const tick = (): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, 0);
  });

describe("createKeyedLimiter", () => {
  it("never runs more than the limit at once for one key, and starts tasks in arrival order", async () => {
    const limiter = createKeyedLimiter(2);
    const gates = [deferred(), deferred(), deferred(), deferred()];
    const started: number[] = [];
    let active = 0;
    let peak = 0;

    const runs = gates.map((gate, index) =>
      limiter.run("account-a", async () => {
        active += 1;
        peak = Math.max(peak, active);
        started.push(index);
        await gate.promise;
        active -= 1;
        return index;
      }),
    );

    await tick();
    expect(started).toEqual([0, 1]);

    gates[0]?.resolve();
    await tick();
    expect(started).toEqual([0, 1, 2]);

    for (const gate of gates) {
      gate.resolve();
    }
    expect(await Promise.all(runs)).toEqual([0, 1, 2, 3]);
    expect(peak).toBe(2);
    expect(limiter.size()).toBe(0);
  });

  it("does not let one key block another", async () => {
    const limiter = createKeyedLimiter(1);
    const blocker = deferred();
    const blocked = limiter.run("a", () => blocker.promise);
    const other = limiter.run("b", () => Promise.resolve("done"));

    expect(await other).toBe("done");
    expect(limiter.size()).toBe(1);

    blocker.resolve();
    await blocked;
    expect(limiter.size()).toBe(0);
  });

  it("releases the slot and rejects the caller when a task throws", async () => {
    const limiter = createKeyedLimiter(1);
    const failing = limiter.run("a", () => Promise.reject(new Error("boom")));
    const after = limiter.run("a", () => Promise.resolve("still works"));

    await expect(failing).rejects.toThrow("boom");
    expect(await after).toBe("still works");
    expect(limiter.size()).toBe(0);
  });

  it("returns each task's own result", async () => {
    const limiter = createKeyedLimiter(3);
    const results = await Promise.all(
      [1, 2, 3, 4, 5].map((n) =>
        limiter.run("a", () => Promise.resolve(n * 10)),
      ),
    );
    expect(results).toEqual([10, 20, 30, 40, 50]);
  });

  it("rejects an invalid limit", () => {
    expect(() => createKeyedLimiter(0)).toThrow(RangeError);
    expect(() => createKeyedLimiter(1.5)).toThrow(RangeError);
  });
});
