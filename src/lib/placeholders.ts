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

function getQuoteContext(text: string, offset: number): "single" | "double" | "bare" {
  let inSingle = false;
  let inDouble = false;
  let escaped = false;

  for (let i = 0; i < offset; i++) {
    const c = text[i];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (c === "\\" && !inSingle) {
      escaped = true;
      continue;
    }
    if (c === "'" && !inDouble) {
      inSingle = !inSingle;
      continue;
    }
    if (c === '"' && !inSingle) {
      inDouble = !inDouble;
      continue;
    }
  }

  if (inSingle) return "single";
  if (inDouble) return "double";
  return "bare";
}

/**
 * Substitute values into a command.
 *
 * The quotation context across the command decides the escaping, so
 * the result is safe whether or not the author added their own quotes.
 */
export function fillPlaceholders(text: string, values: Record<string, string>): string {
  return text.replace(TOKEN, (token, name: string, offset: number) => {
    const value = values[name];
    if (value === undefined) return token;

    const ctx = getQuoteContext(text, offset);

    // Already inside double quotes: neutralise what the shell would expand.
    if (ctx === "double") {
      return value.replace(/(["\\$`])/g, "\\$1");
    }
    // Already inside single quotes: only an apostrophe can escape.
    if (ctx === "single") {
      return value.split("'").join(`'\\''`);
    }
    // Bare: quote it ourselves so spaces stay one argument.
    return singleQuoted(value);
  });
}
