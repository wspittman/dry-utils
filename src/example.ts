/**
 * Capitalizes the first letter of a string and lowercases the rest
 * @param input - The string to capitalize
 * @returns The capitalized string
 */
export function capitalize(input: string): string {
  if (!input) return input;
  return input.charAt(0).toUpperCase() + input.slice(1).toLowerCase();
}
