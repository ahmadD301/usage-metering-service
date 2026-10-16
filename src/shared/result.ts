export type OK<T> = {
  type: "ok";
  value: T;
};
export type Err<E> = {
  type: "err";
  error: E;
};
export type Result<T, E> = OK<T> | Err<E>;
export type ResultHandlers<T, E, R> = {
  ok: (value: T) => R;
  err: (error: E) => R;
};

export const ok = <T>(value: T): OK<T> => {
  return {
    type: "ok",
    value: value,
  };
};

export const err = <E>(error: E): Err<E> => {
  return {
    type: "err",
    error: error,
  };
};

// apply a function to the value only if the result is successful
export const mapResult = <T, U, E>(
  result: Result<T, E>,
  transform: (value: T) => U,
): Result<U, E> => {
  if (result.type === "ok") {
    const newValue = transform(result.value);
    return ok(newValue);
  }

  // if the result failed return the same error
  return result;
};

// apply a function that returns another Result
export const andThen = <T, U, E>(
  result: Result<T, E>,
  nextOperation: (value: T) => Result<U, E>,
): Result<U, E> => {
  if (result.type === "ok") {
    return nextOperation(result.value);
  }

  // stop if the previous operation failed
  return result;
};

export const match = <T, E, R>(
  result: Result<T, E>,
  handlers: ResultHandlers<T, E, R>,
): R => {
  if (result.type === "ok") {
    return handlers.ok(result.value);
  }
  return handlers.err(result.error);
};
