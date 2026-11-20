/** Escapes user input so it matches literally inside a RegExp. */
export function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Case-insensitive "contains" matcher for user-supplied search text. */
export function containsInsensitive(search: string): RegExp {
  return new RegExp(escapeRegex(search), 'i');
}
