/**
 * Run-time inputs.
 *
 * Commands cannot be typed into while they run — Fuse gives them no terminal,
 * so anything that would prompt fails instead of hanging. The answer for
 * values you want to decide at run time is a placeholder:
 *
 *     git commit -m {{message}}
 *
 * Fuse asks for `message` just before the run and substitutes it in. The
 * substitution is shell-aware: an unquoted placeholder is quoted for you, and
 * one you quoted yourself is escaped to match, so a commit message containing
 * spaces or apostrophes cannot break out of the command it sits in.
 */

const TOKEN = /\{\{\s*([A-Za-z_][A-Za-z0-9_-]*)\s*\}\}/g;

/** Placeholder names used in `text`, in first-seen order, without repeats. */
export function placeholdersIn(text: string): string[] {
  const names: string[] = [];
  for (const match of text.matchAll(TOKEN)) {
    const name = match[1];
    if (name && !names.includes(name)) names.push(name);
  }
  return names;
}

/**
 * Substitute values with no escaping at all.
 *
 * For text the shell never parses: a script's body, a URL, a JSON payload.
 * Quoting those would put literal apostrophes into Python source or into the
 * middle of a URL.
 */
export function fillPlaceholdersRaw(text: string, values: Record<string, string>): string {
  return text.replace(TOKEN, (token, name: string) => values[name] ?? token);
}

/** Wrap in single quotes, ending and reopening the quote around any apostrophe. */
function singleQuoted(value: string): string {
  return `'${value.split("'").join(`'\\''`)}'`;
}

/**
 * Substitute values into a command.
 *
 * The character on either side of the placeholder decides the escaping, so
 * the result is safe whether or not the author added their own quotes.
 */
export function fillPlaceholders(text: string, values: Record<string, string>): string {
  return text.replace(TOKEN, (token, name: string, offset: number) => {
    const value = values[name];
    if (value === undefined) return token;

    const before = text[offset - 1];
    const after = text[offset + token.length];

    // Already inside double quotes: neutralise what the shell would expand.
    if (before === '"' && after === '"') {
      return value.replace(/(["\\$`])/g, "\\$1");
    }
    // Already inside single quotes: only an apostrophe can escape.
    if (before === "'" && after === "'") {
      return value.split("'").join(`'\\''`);
    }
    // Bare: quote it ourselves so spaces stay one argument.
    return singleQuoted(value);
  });
}
