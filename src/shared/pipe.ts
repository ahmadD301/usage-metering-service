// initial vaklue only, no functions to apply
export function pipe<A>(initialValue: A): A;

// with one function
export function pipe<A, B>(initialValue: A, func1: (value: A) => B): B;

// with two functions
export function pipe<A, B, C>(
  initialValue: A,
  func1: (value: A) => B,
  func2: (value: B) => C,
): C;

// with three functions
export function pipe<A, B, C, D>(
  initialValue: A,
  func1: (value: A) => B,
  func2: (value: B) => C,
  func3: (value: C) => D,
): D;

// with four functions
export function pipe<A, B, C, D, E>(
  initialValue: A,
  func1: (value: A) => B,
  func2: (value: B) => C,
  func3: (value: C) => D,
  func4: (value: D) => E,
): E;

// Implementation
// This implementation uses a rest parameter to accept any number of functions
export function pipe(
  initial: unknown,
  ...functions: readonly ((value: unknown) => unknown)[]
): unknown {
  let result = initial;
  for (const func of functions) {
    result = func(result);
  }
  return result;
}
