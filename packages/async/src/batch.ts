import { diag } from "./diagnostics.ts";

/**
 * A failed value from a batch run.
 */
export interface BatchFailure<T> {
  /** Index of the failed value in the original input array. */
  index: number;
  /** Value that failed. */
  value: T;
  /** Error thrown by the batch function. */
  error: unknown;
}

/**
 * Processes an array of values in batches using an async function.
 * Handles errors gracefully and logs batch start/end/errors.
 *
 * @param name - The name of the batch operation for logging
 * @param values - Array of values to process
 * @param fn - Async function to process each value
 * @param size - Maximum batch size for concurrent processing (default: 5)
 * @returns Failed values from the batch run
 */
export async function batch<T>(
  name: string,
  values: T[],
  fn: (value: T) => Promise<void>,
  size = 5,
): Promise<BatchFailure<T>[]> {
  if (!values.length) return [];
  if (!Number.isInteger(size) || size <= 0) {
    throw new RangeError("Batch size must be a positive integer");
  }

  const failures: BatchFailure<T>[] = [];

  diag.log(`Batch_${name}`, values.length);

  for (let i = 0; i < values.length; i += size) {
    const batch = values.slice(i, i + size);
    const result = await Promise.allSettled(batch.map((value) => fn(value)));

    result.forEach((r, index) => {
      if (r.status === "rejected") {
        diag.error(`Batch_${name}: at values[${i + index}]`, r.reason);
        failures.push({
          index: i + index,
          value: batch[index]!,
          error: r.reason,
        });
      }
    });
  }

  diag.log(`Batch_${name}`, "Complete");

  return failures;
}
