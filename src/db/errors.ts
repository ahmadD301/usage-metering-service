export const UNIQUE_VIOLATION = "23505";

// Extracts the Postgres SQLSTATE code from an unknown thrown value
export const pgErrorCode = (error: unknown): string | null => {
  if (typeof error === "object" && error !== null && "code" in error) {
    const code = error.code;

    if (typeof code === "string") {
      return code;
    }
  }

  return null;
};
