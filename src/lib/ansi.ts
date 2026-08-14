/**
 * Terminal colour.
 *
 * Commands run under `TERM=xterm-256color` with the usual force-colour flags
 * set (see `NON_INTERACTIVE_ENV` in `process.rs`), so most tools emit real ANSI
 * escapes. This turns those escapes into styled runs of text.
 *
 * Two things beyond plain parsing earn their place here:
 *
 *   * The palette is the app's palette, not the terminal's. A command's idea
 *     of "red" is remapped onto Fuse's danger colour so output sits in the same
 *     world as the rest of the window instead of looking pasted in.
 *   * Tools that emit no colour at all still get some, from `classify` — the
 *     difference between a wall of grey and a readable log is usually just
 *     knowing which line is the error.
 */

export type AnsiStyle = {
  color?: string;
  background?: string;
  bold?: boolean;
  dim?: boolean;
  italic?: boolean;
  underline?: boolean;
  strike?: boolean;
};

export type AnsiSegment = AnsiStyle & { text: string };

/** Standard colours 0–7, tuned to the app's palette rather than a VGA one. */
const NORMAL = [
  "#5c5c66", // black -> still legible on a dark background
  "#f2555f", // red
  "#3ecf8e", // green
  "#f5a524", // yellow
  "#7d8bff", // blue — lifted; the accent is too dark to read as body text
  "#c47dff", // magenta
  "#3ec9d6", // cyan
  "#c9c9d2", // white
];

/** Bright colours 8–15. */
const BRIGHT = [
  "#7b7b86",
  "#ff8189",
  "#63e0aa",
  "#ffc457",
  "#a3adff",
  "#d9a2ff",
  "#6fe3ee",
  "#ededef",
];

function rgb(r: number, g: number, b: number): string {
  const hex = (v: number) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0");
  return `#${hex(r)}${hex(g)}${hex(b)}`;
}

/** The 6×6×6 cube and the greyscale ramp of the 256-colour palette. */
function xterm256(index: number): string {
  if (index < 8) return NORMAL[index]!;
  if (index < 16) return BRIGHT[index - 8]!;

  if (index < 232) {
    const n = index - 16;
    const steps = [0, 95, 135, 175, 215, 255];
    return rgb(steps[Math.floor(n / 36) % 6]!, steps[Math.floor(n / 6) % 6]!, steps[n % 6]!);
  }

  const level = 8 + (index - 232) * 10;
  return rgb(level, level, level);
}

/** Apply one run of SGR parameters, returning the resulting style. */
function applySgr(style: AnsiStyle, params: number[]): AnsiStyle {
  const next: AnsiStyle = { ...style };

  for (let i = 0; i < params.length; i += 1) {
    const code = params[i]!;

    if (code === 0) {
      // Reset: back to the stream's own default.
      for (const key of Object.keys(next) as (keyof AnsiStyle)[]) delete next[key];
      continue;
    }

    if (code === 1) next.bold = true;
    else if (code === 2) next.dim = true;
    else if (code === 3) next.italic = true;
    else if (code === 4) next.underline = true;
    else if (code === 9) next.strike = true;
    else if (code === 22) {
      next.bold = false;
      next.dim = false;
    } else if (code === 23) next.italic = false;
    else if (code === 24) next.underline = false;
    else if (code === 29) next.strike = false;
    else if (code >= 30 && code <= 37) next.color = NORMAL[code - 30];
    else if (code >= 90 && code <= 97) next.color = BRIGHT[code - 90];
    else if (code === 39) delete next.color;
    else if (code >= 40 && code <= 47) next.background = NORMAL[code - 40];
    else if (code >= 100 && code <= 107) next.background = BRIGHT[code - 100];
    else if (code === 49) delete next.background;
    else if (code === 38 || code === 48) {
      // Extended colour: `5;n` (indexed) or `2;r;g;b` (truecolor).
      const mode = params[i + 1];
      let value: string | undefined;

      if (mode === 5 && params[i + 2] !== undefined) {
        value = xterm256(params[i + 2]!);
        i += 2;
      } else if (mode === 2 && params[i + 4] !== undefined) {
        value = rgb(params[i + 2]!, params[i + 3]!, params[i + 4]!);
        i += 4;
      } else {
        // Malformed: the rest of this sequence cannot be trusted.
        break;
      }

      if (code === 38) next.color = value;
      else next.background = value;
    }
    // Anything else (inverse, alternate fonts, blink) is ignored: it either
    // has no meaning here or would only hurt legibility.
  }

  return next;
}

const ESC = "\u001B";
/** The single-byte C1 form of `ESC [`, which some tools emit instead. */
const CSI = "\u009B";
const BEL = "\u0007";

/**
 * Split a line into styled runs.
 *
 * Escapes Fuse cannot honour — cursor moves, screen clears, OSC titles — are
 * dropped rather than printed as mojibake.
 */
export function parseAnsi(text: string): AnsiSegment[] {
  if (!text.includes(ESC) && !text.includes(CSI)) {
    return text ? [{ text }] : [];
  }

  const segments: AnsiSegment[] = [];
  let style: AnsiStyle = {};
  let buffer = "";
  let i = 0;

  const flush = () => {
    if (buffer) {
      segments.push({ ...style, text: buffer });
      buffer = "";
    }
  };

  while (i < text.length) {
    const char = text[i]!;

    // A control sequence, written either as `ESC [` or as the C1 byte.
    const opener = char === CSI ? 1 : char === ESC && text[i + 1] === "[" ? 2 : 0;
    if (opener) {
      let j = i + opener;
      while (j < text.length && !/[@-~]/.test(text[j]!)) j += 1;
      const body = text.slice(i + opener, j);

      if (text[j] === "m") {
        flush();
        const params = body
          .split(";")
          .map((part) => (part === "" ? 0 : Number.parseInt(part, 10)))
          .map((n) => (Number.isNaN(n) ? 0 : n));
        style = applySgr(style, params);
      }
      // Every other sequence is a cursor move or an erase: swallow it.
      i = j + 1;
      continue;
    }

    // OSC (window titles, hyperlinks) runs until BEL or ST.
    if (char === ESC && text[i + 1] === "]") {
      let j = i + 2;
      while (j < text.length && text[j] !== BEL && !(text[j] === ESC && text[j + 1] === "\\")) {
        j += 1;
      }
      i = text[j] === ESC ? j + 2 : j + 1;
      continue;
    }

    // Any other escape: drop it along with the byte it introduces.
    if (char === ESC) {
      i += 2;
      continue;
    }

    buffer += char;
    i += 1;
  }

  flush();
  return segments;
}

/** The same text with every escape removed. */
export function stripAnsi(text: string): string {
  return parseAnsi(text)
    .map((segment) => segment.text)
    .join("");
}

/** True when the line brought colour of its own. */
export function hasAnsiColor(segments: AnsiSegment[]): boolean {
  return segments.some((segment) => segment.color !== undefined || segment.background !== undefined);
}

export type LineTone = "error" | "warn" | "success" | "note" | null;

const ERROR_LINE =
  /^(?:\[[^\]]*\]\s*)?(?:error|fatal|failed|failure|panic|exception|traceback|✗|✖|×|✘)\b/i;
const ERROR_ANYWHERE = /\berror:|\bERR!|\bfatal:|\bFAILED\b|\bFAIL\b/;
const WARN_LINE = /^(?:\[[^\]]*\]\s*)?(?:warn|warning|deprecated|⚠)\b/i;
const WARN_ANYWHERE = /\bwarning:|\bWARN\b|\bdeprecated\b/i;
const SUCCESS_LINE = /^(?:✓|✔|√|success|passed|ok\b|done\b|built\b|compiled\b)/i;
const NOTE_LINE = /^(?:\$|>|#|→|»)\s/;

/**
 * A tone for output that carried no colour of its own.
 *
 * Deliberately conservative: it looks for the shapes tools actually use at the
 * start of a line, so ordinary prose that happens to contain the word "error"
 * is left alone.
 */
export function classify(text: string): LineTone {
  const line = text.trim();
  if (!line) return null;

  if (ERROR_LINE.test(line) || ERROR_ANYWHERE.test(line)) return "error";
  if (WARN_LINE.test(line) || WARN_ANYWHERE.test(line)) return "warn";
  if (SUCCESS_LINE.test(line)) return "success";
  if (NOTE_LINE.test(line)) return "note";
  return null;
}

/** Base colour for a line that styled nothing itself. */
export const TONE_COLOR: Record<Exclude<LineTone, null>, string> = {
  error: "#ff8189",
  warn: "#ffc457",
  success: "#63e0aa",
  note: "#8b8b95",
};

/** Default colour per stream, for text with neither escapes nor a tone. */
export const STREAM_COLOR = {
  stdout: "#c9c9d2",
  stderr: "#e6a9ae",
} as const;
