import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Check, Play, ShieldQuestionMark, Split, Square, TextCursorInput } from "lucide-react";
import { useRuntimeStore } from "@/store/runtimeStore";
import { useWorkflowStore } from "@/store/workflowStore";
import { Button } from "@/components/ui/Button";
import { Kbd } from "@/components/ui/Kbd";
import { TerminalLine } from "@/components/ui/TerminalLine";
import { answerPrompt } from "@/lib/actions";
import { cn } from "@/lib/utils";
import type { PromptRequest } from "@/types/workflow";

/** How much of the upstream output to show without scrolling forever. */
const OUTPUT_TAIL = 400;

/**
 * The run is stopped and waiting on the person watching it.
 *
 * Everything about this dialog assumes the answer matters: it cannot be
 * dismissed by clicking away, the output that the decision is *about* is right
 * there above the buttons, and stopping is always one key press away.
 */
export function PromptDialog() {
  const prompt = useRuntimeStore((s) => s.prompt);
  if (!prompt) return null;
  // Keyed so switching from one question to the next starts from scratch
  // rather than showing the previous answer half-typed.
  return <PromptBody key={`${prompt.runId}:${prompt.nodeId}`} prompt={prompt} />;
}

function PromptBody({ prompt }: { prompt: PromptRequest }) {
  const [picked, setPicked] = useState<string[]>(() =>
    prompt.kind === "choice" && prompt.options[0] ? [prompt.options[0].nodeId] : [],
  );
  const [value, setValue] = useState(prompt.kind === "input" ? prompt.defaultValue : "");
  const fieldRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    fieldRef.current?.focus();
    fieldRef.current?.select();
  }, []);

  const stop = () => void answerPrompt(prompt, { reply: "deny" });

  const submit = () => {
    if (prompt.kind === "approval") {
      void answerPrompt(prompt, { reply: "approve" });
      return;
    }
    if (prompt.kind === "choice") {
      if (picked.length === 0) return;
      void answerPrompt(prompt, { reply: "choose", nodeIds: picked });
      return;
    }
    void answerPrompt(prompt, { reply: "value", value });
  };

  const toggle = (nodeId: string) => {
    if (prompt.kind !== "choice") return;
    if (!prompt.allowMultiple) {
      setPicked([nodeId]);
      return;
    }
    setPicked((current) =>
      current.includes(nodeId) ? current.filter((id) => id !== nodeId) : [...current, nodeId],
    );
  };

  const Icon =
    prompt.kind === "approval"
      ? ShieldQuestionMark
      : prompt.kind === "choice"
        ? Split
        : TextCursorInput;

  return (
    <div className="fixed inset-0 z-[60] flex items-start justify-center pt-[12vh]">
      {/* No click-away: leaving a run parked because the pointer slipped is
          worse than making the decision explicit. */}
      <div className="absolute inset-0 bg-canvas/70 backdrop-blur-[2px]" aria-hidden />

      <div
        role="dialog"
        aria-modal="true"
        aria-label={prompt.title}
        className={cn(
          "animate-in-soft relative flex w-[620px] max-w-[calc(100vw-32px)] flex-col overflow-hidden",
          "rounded-xl border border-warn/40 bg-base shadow-[0_18px_60px_-12px_rgba(0,0,0,0.85)]",
        )}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === "Escape") {
            stop();
            return;
          }
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            submit();
            return;
          }
          // 1–9 jump straight to an option.
          if (prompt.kind === "choice" && /^[1-9]$/.test(e.key)) {
            const option = prompt.options[Number(e.key) - 1];
            if (option) {
              e.preventDefault();
              toggle(option.nodeId);
            }
          }
        }}
      >
        <header className="flex items-center gap-2 border-b border-line px-3.5 py-2.5">
          <Icon size={13} strokeWidth={1.75} className="shrink-0 text-warn" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-[12px] font-medium text-fg">{prompt.title}</p>
            <p className="mt-0.5 text-[11px] text-fg-subtle">
              The workflow is paused here and will not go on until you answer.
            </p>
          </div>
          <span className="shrink-0 rounded-[5px] bg-warn/12 px-1.5 py-0.5 text-[10px] font-medium text-warn">
            Waiting
          </span>
        </header>

        {prompt.message.trim() && (
          <p className="px-3.5 pt-3 text-[12.5px] leading-[18px] text-fg">{prompt.message}</p>
        )}

        <SourceOutput nodeIds={prompt.sources} />

        {prompt.kind === "choice" && (
          <div className="max-h-[220px] space-y-1 overflow-y-auto px-3.5 py-3">
            {prompt.options.map((option, index) => {
              const on = picked.includes(option.nodeId);
              return (
                <button
                  key={option.nodeId}
                  type="button"
                  onClick={() => toggle(option.nodeId)}
                  className={cn(
                    "flex w-full items-center gap-2.5 rounded-[8px] border px-2.5 py-2 text-left transition",
                    on
                      ? "border-accent/70 bg-accent/10"
                      : "border-line bg-elevated/40 hover:border-line-strong hover:bg-hover",
                  )}
                >
                  <span
                    className={cn(
                      "flex size-[18px] shrink-0 items-center justify-center rounded-[5px] text-[10px] tabular-nums",
                      on ? "bg-accent text-white" : "bg-hover text-fg-subtle",
                    )}
                  >
                    {on ? <Check size={11} strokeWidth={3} /> : index + 1}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[12px] text-fg">{option.label}</span>
                    {option.detail && (
                      <span className="block truncate font-mono text-[10.5px] text-fg-subtle">
                        {option.detail}
                      </span>
                    )}
                  </span>
                </button>
              );
            })}
            {prompt.allowMultiple && (
              <p className="pt-1 text-[10.5px] text-fg-subtle">
                Pick as many as you like — each one runs.
              </p>
            )}
          </div>
        )}

        {prompt.kind === "input" && (
          <div className="flex items-center gap-2.5 px-3.5 py-3">
            <label
              htmlFor="prompt-value"
              className="shrink-0 font-mono text-[11px] text-fg-muted"
              title={prompt.variable}
            >
              {prompt.variable}
            </label>
            <input
              id="prompt-value"
              ref={fieldRef}
              type={prompt.secret ? "password" : "text"}
              value={value}
              spellCheck={false}
              autoCapitalize="off"
              autoCorrect="off"
              onChange={(e) => setValue(e.currentTarget.value)}
              className="min-w-0 flex-1 rounded-[7px] border border-line bg-elevated px-2.5 py-1.5 font-mono text-[12px] text-fg outline-none focus:border-accent/70"
            />
          </div>
        )}

        <footer className="flex items-center gap-1.5 border-t border-line px-3.5 py-2.5">
          <span className="flex items-center gap-1 text-[10.5px] text-fg-subtle">
            <Kbd>↵</Kbd>
            {prompt.kind === "approval" ? "continue" : "confirm"}
            <span className="mx-1 text-fg-subtle/50">·</span>
            <Kbd>esc</Kbd> stop
          </span>

          <div className="flex-1" />

          <Button variant="danger" onClick={stop}>
            <Square size={9} fill="currentColor" strokeWidth={0} />
            {prompt.kind === "approval" ? prompt.stopLabel : "Stop run"}
          </Button>

          <Button
            variant="primary"
            onClick={submit}
            disabled={prompt.kind === "choice" && picked.length === 0}
          >
            <Play size={10} fill="currentColor" strokeWidth={0} />
            {prompt.kind === "approval" ? prompt.continueLabel : "Continue"}
          </Button>
        </footer>
      </div>
    </div>
  );
}

/**
 * What the steps feeding this one printed — the thing the decision is about.
 *
 * Deliberately the tail rather than the whole log: the end of the output is
 * what a person reads before deciding, and the full history is still in the
 * output panel behind the dialog.
 */
function SourceOutput({ nodeIds }: { nodeIds: string[] }) {
  const output = useRuntimeStore((s) => s.output);
  const nodes = useWorkflowStore((s) => s.nodes);
  const scrollRef = useRef<HTMLDivElement>(null);

  const blocks = useMemo(
    () =>
      nodeIds
        .map((id) => ({
          id,
          label: nodes.find((n) => n.id === id)?.data.label || "Step",
          lines: (output[id] ?? []).slice(-OUTPUT_TAIL),
        }))
        .filter((block) => block.lines.length > 0),
    [nodeIds, nodes, output],
  );

  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [blocks]);

  if (blocks.length === 0) {
    return (
      <p className="border-t border-line/70 px-3.5 py-2.5 text-[11px] text-fg-subtle">
        Nothing ran before this step, so there is no output to check.
      </p>
    );
  }

  return (
    <div
      ref={scrollRef}
      className="selectable max-h-[280px] min-h-[80px] overflow-auto border-y border-line bg-canvas/60 px-3.5 py-2.5"
    >
      {blocks.map((block) => (
        <div key={block.id} className="mb-2 last:mb-0">
          <div className="mb-1 flex items-center gap-1.5">
            <span className="text-[10px] tracking-wide text-fg-subtle uppercase">
              {block.label}
            </span>
            <span className="h-px flex-1 bg-line" />
          </div>
          {block.lines.map((line, index) => (
            <TerminalLine
              key={`${line.at}-${index}`}
              text={line.text}
              stream={line.stream}
            />
          ))}
        </div>
      ))}
    </div>
  );
}
