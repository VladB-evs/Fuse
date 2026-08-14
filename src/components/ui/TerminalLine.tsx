import { memo, useMemo, type CSSProperties } from "react";
import {
  classify,
  hasAnsiColor,
  parseAnsi,
  STREAM_COLOR,
  TONE_COLOR,
  type AnsiSegment,
} from "@/lib/ansi";
import { cn } from "@/lib/utils";
import type { OutputStream } from "@/types/workflow";

/**
 * One line of command output.
 *
 * Colour comes from three places, in order of authority:
 *
 *   1. The command's own ANSI escapes, if it emitted any.
 *   2. A tone read off the shape of the line — the error/warning/success
 *      prefixes tools use even when they print no colour at all.
 *   3. The stream it arrived on: stdout reads as normal text, stderr warmer.
 *
 * Only the first of those can style *part* of a line, which is why the whole
 * line falls back to a single colour rather than trying to be clever.
 */
function TerminalLineImpl({
  text,
  stream,
  className,
}: {
  text: string;
  stream: OutputStream;
  className?: string;
}) {
  const { segments, fallback } = useMemo(() => {
    const parsed = parseAnsi(text);
    if (hasAnsiColor(parsed)) return { segments: parsed, fallback: undefined };

    const tone = classify(stripped(parsed));
    return {
      segments: parsed,
      fallback: tone ? TONE_COLOR[tone] : STREAM_COLOR[stream],
    };
  }, [text, stream]);

  return (
    <div
      className={cn("font-mono text-[11.5px] leading-[17px] break-all whitespace-pre-wrap", className)}
      style={fallback ? { color: fallback } : undefined}
    >
      {segments.length === 0 ? " " : segments.map((segment, index) => (
        <span key={index} style={styleOf(segment)}>
          {segment.text}
        </span>
      ))}
    </div>
  );
}

function stripped(segments: AnsiSegment[]): string {
  return segments.map((segment) => segment.text).join("");
}

function styleOf(segment: AnsiSegment): CSSProperties | undefined {
  const style: CSSProperties = {};
  if (segment.color) style.color = segment.color;
  if (segment.background) {
    style.background = segment.background;
    // Backgrounds are used for highlights (diffs, test runners); a little
    // padding keeps them from touching the text.
    style.borderRadius = "2px";
    style.padding = "0 2px";
  }
  if (segment.bold) style.fontWeight = 600;
  if (segment.dim) style.opacity = 0.62;
  if (segment.italic) style.fontStyle = "italic";
  if (segment.underline) style.textDecoration = "underline";
  if (segment.strike) {
    style.textDecoration = segment.underline ? "underline line-through" : "line-through";
  }
  return Object.keys(style).length > 0 ? style : undefined;
}

export const TerminalLine = memo(TerminalLineImpl);
