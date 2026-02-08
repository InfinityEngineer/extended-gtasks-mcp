/**
 * Retry helper for Google Tasks API calls.
 * Wraps an async function with configurable retries and exponential backoff.
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  retries = 1,
  delayMs = 1000
): Promise<T> {
  try {
    return await fn();
  } catch (error: any) {
    if (retries > 0 && isRetryable(error)) {
      console.error(
        `Retryable error (${error?.response?.status || error?.code || "unknown"}), attempting retry in ${delayMs}ms...`
      );
      await new Promise((resolve) => setTimeout(resolve, delayMs));
      return withRetry(fn, retries - 1, delayMs * 2);
    }
    throw error;
  }
}

function isRetryable(error: any): boolean {
  const status = error?.response?.status || error?.code;
  // Retry on: 401 (token expired), 429 (rate limit), 500/503 (server error), network errors
  return (
    [401, 429, 500, 503].includes(status) ||
    error.code === "ECONNRESET" ||
    error.code === "ETIMEDOUT"
  );
}
