const validProp = /^[A-Za-z0-9_]+(?:\.[A-Za-z0-9_]+)*$/;

/**
 * Validates that a Cosmos DB property path is safe to interpolate into SQL.
 * Throws if the path contains anything other than `A-Za-z0-9_` identifiers
 * separated by `.`.
 */
export function validatePropPath(value: string): void {
  if (!validProp.test(value)) {
    throw new Error(
      `Invalid property path "${value}". Only A-Za-z0-9_ identifiers separated by '.' are allowed.`,
    );
  }
}
