/**
 * Exhaustiveness helper for discriminated unions.
 * If a `switch` forgets a case, the call site stops compiling because the
 * leftover value is no longer of type `never`.
 */
export const assertNever = (value: never): never => {
  throw new Error(`Unhandled case: ${JSON.stringify(value)}`);
};
/*
This helper makes forgotten cases in future domain decisions fail at compile time.
 The runtime exception also makes invalid external data fail 
 explicitly instead of silently producing a success-shaped result.
*/
