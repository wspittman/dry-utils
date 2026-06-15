const validProp = /^[A-Za-z0-9_]+(?:\.[A-Za-z0-9_]+)*$/;

/** Maximum byte length for a Cosmos DB item ID. */
const MAX_ID_BYTES = 1023;

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

/**
 * Validates that a Cosmos DB item ID is safe to use.
 * Throws if the ID is empty, contains forbidden characters (`/`, `\`, `#`, `?`),
 * or exceeds 1,023 bytes.
 *
 * Forbidden characters: `/` and `\` are rejected by the service; `#` is
 * treated as a URL fragment delimiter by HTTP infrastructure; `?` introduces
 * query strings. None of these are allowed in IDs used in REST paths.
 */
export function validateItemId(id: string): void {
  if (!id) {
    throw new Error("Item ID must not be empty.");
  }
  if (/[/\\#?]/.test(id)) {
    throw new Error(
      `Item ID contains an invalid character ('/', '\\', '#', or '?'). These are not allowed in Cosmos DB item IDs.`,
    );
  }
  if (Buffer.byteLength(id, "utf8") > MAX_ID_BYTES) {
    throw new Error(
      `Item ID exceeds the maximum allowed length of ${MAX_ID_BYTES} bytes.`,
    );
  }
}
