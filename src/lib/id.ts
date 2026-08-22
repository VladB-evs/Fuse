/** Ids must stay filename-safe: the store validates `[A-Za-z0-9_-]`. */
export function newId(): string {
  const uuid = globalThis.crypto?.randomUUID?.();
  if (uuid) return uuid;
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Turn a human-readable workflow name into a stable, filesystem-safe id.
 *
 * - Unicode letters/digits → kept (ASCII-lowercased)
 * - Spaces and punctuation → replaced with `-`
 * - Runs of dashes collapsed; leading/trailing dashes stripped
 * - Capped at 48 chars so the full `<name>.json` stays well under 255
 * - If the result is empty (e.g. all emoji) falls back to a timestamp slug
 */
export function slugifyName(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  return slug || `wf-${Date.now().toString(36)}`;
}
