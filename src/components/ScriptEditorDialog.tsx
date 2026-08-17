import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Copy,
  FileCode2,
  Loader2,
  Maximize2,
  Minimize2,
  Play,
  RotateCcw,
  Terminal,
  X,
  XCircle,
} from "lucide-react";
import { useUIStore } from "@/store/uiStore";
import { useWorkflowStore } from "@/store/workflowStore";
import { useRuntimeStore } from "@/store/runtimeStore";
import { runSingleNode } from "@/lib/actions";
import { getPrismLanguage, highlightCode } from "@/lib/syntaxHighlight";
import { cn, formatDuration } from "@/lib/utils";
import { TerminalLine } from "@/components/ui/TerminalLine";
import type { ScriptNodeType } from "@/types/workflow";

const COMMON_INTERPRETERS = ["bash", "zsh", "sh", "python3", "node", "ruby", "custom…"];

export function ScriptEditorDialog() {
  const scriptEditorNodeId = useUIStore((s) => s.scriptEditorNodeId);
  if (!scriptEditorNodeId) return null;
  return <ScriptEditorBody nodeId={scriptEditorNodeId} />;
}

function ScriptEditorBody({ nodeId }: { nodeId: string }) {
  const close = useUIStore((s) => s.closeScriptEditor);
  const isRunning = useRuntimeStore((s) => s.running);

  const node = useWorkflowStore((s) =>
    s.nodes.find((n) => n.id === nodeId),
  ) as ScriptNodeType | undefined;

  const updateNodeData = useWorkflowStore((s) => s.updateNodeData);
  const beginEdit = useWorkflowStore((s) => s.beginEdit);

  const outputLines = useRuntimeStore((s) => s.output[nodeId] ?? []);
  const nodeStatus = useRuntimeStore((s) => s.statuses[nodeId] ?? "idle");
  const nodeMeta = useRuntimeStore((s) => s.meta[nodeId]);
  const clearOutput = useRuntimeStore((s) => s.clearOutput);

  const [isFullscreen, setIsFullscreen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [showOutput, setShowOutput] = useState(true);

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const preRef = useRef<HTMLPreElement>(null);
  const gutterRef = useRef<HTMLDivElement>(null);
  const outputScrollRef = useRef<HTMLDivElement>(null);

  const script = node?.data.script ?? "";
  const interpreter = node?.data.interpreter ?? "bash";
  const label = node?.data.label ?? "Script";
  const continueOnError = !!node?.data.continueOnError;

  const isKnownInterpreter = COMMON_INTERPRETERS.slice(0, -1).includes(interpreter);
  const prismLang = useMemo(() => getPrismLanguage(interpreter), [interpreter]);
  const highlighted = useMemo(() => highlightCode(script, prismLang), [script, prismLang]);

  const lineCount = useMemo(() => {
    return Math.max(1, script.split("\n").length);
  }, [script]);

  // Focus textarea when modal opens
  useEffect(() => {
    if (node) {
      setTimeout(() => {
        textareaRef.current?.focus();
      }, 50);
    }
  }, [node?.id]);

  // Global escape key handler
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        close();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [close]);

  const handleScroll = useCallback(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    if (preRef.current) {
      preRef.current.scrollTop = textarea.scrollTop;
      preRef.current.scrollLeft = textarea.scrollLeft;
    }
    if (gutterRef.current) {
      gutterRef.current.scrollTop = textarea.scrollTop;
    }
  }, []);

  const handleRun = useCallback(async () => {
    if (!node || !script?.trim()) return;
    try {
      await runSingleNode(node.id);
    } catch (err) {
      console.error(err);
    }
  }, [node, script]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      e.stopPropagation();
      const textarea = textareaRef.current;
      if (!textarea || !node) return;

      // Run on Cmd+R / Ctrl+R
      if (e.key.toLowerCase() === "r" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        void handleRun();
        return;
      }

      // Close on Cmd+Enter / Ctrl+Enter
      if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        close();
        return;
      }

      // Handle Tab and Shift+Tab
      if (e.key === "Tab") {
        e.preventDefault();
        beginEdit();
        const start = textarea.selectionStart;
        const end = textarea.selectionEnd;
        const val = textarea.value;

        if (e.shiftKey) {
          // Unindent
          const lineStart = val.lastIndexOf("\n", start - 1) + 1;
          if (val.slice(lineStart, lineStart + 2) === "  ") {
            const nextVal = val.slice(0, lineStart) + val.slice(lineStart + 2);
            updateNodeData(node.id, { script: nextVal });
            setTimeout(() => {
              textarea.selectionStart = Math.max(lineStart, start - 2);
              textarea.selectionEnd = Math.max(lineStart, end - 2);
            }, 0);
          }
        } else {
          // Indent with 2 spaces
          const nextVal = val.substring(0, start) + "  " + val.substring(end);
          updateNodeData(node.id, { script: nextVal });
          setTimeout(() => {
            textarea.selectionStart = textarea.selectionEnd = start + 2;
          }, 0);
        }
        return;
      }

      // Smart newline indentation
      if (e.key === "Enter" && !e.metaKey && !e.ctrlKey) {
        e.preventDefault();
        beginEdit();
        const start = textarea.selectionStart;
        const val = textarea.value;
        const lineStart = val.lastIndexOf("\n", start - 1) + 1;
        const currentLine = val.substring(lineStart, start);
        const match = currentLine.match(/^(\s+)/);
        const indent = match ? match[1] : "";

        // Extra indent after lines ending in { or :
        const extra = /[{:]\s*$/.test(currentLine) ? "  " : "";
        const insertion = "\n" + indent + extra;

        const nextVal = val.substring(0, start) + insertion + val.substring(textarea.selectionEnd);
        updateNodeData(node.id, { script: nextVal });
        setTimeout(() => {
          textarea.selectionStart = textarea.selectionEnd = start + insertion.length;
        }, 0);
        return;
      }
    },
    [node, close, beginEdit, updateNodeData, handleRun],
  );

  const copyCode = useCallback(() => {
    if (!script) return;
    navigator.clipboard.writeText(script);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }, [script]);

  if (!node || node.type !== "script") return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) close();
      }}
      onKeyDown={(e) => e.stopPropagation()}
    >
      <div className="absolute inset-0 bg-canvas/60 backdrop-blur-[3px]" aria-hidden />

      <div
        className={cn(
          "animate-in-soft relative flex flex-col rounded-xl border border-line-strong bg-base shadow-[0_24px_64px_-12px_rgba(0,0,0,0.85)] overflow-hidden transition-all duration-200",
          isFullscreen
            ? "h-[94vh] w-[96vw] max-w-none"
            : "h-[620px] max-h-[88vh] w-[860px] max-w-[94vw]",
        )}
      >
        {/* Header */}
        <div className="flex h-[46px] shrink-0 items-center justify-between border-b border-line bg-elevated/70 px-4">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="flex size-[24px] shrink-0 items-center justify-center rounded-[6px] bg-accent/15 text-accent">
              <FileCode2 size={14} strokeWidth={2} />
            </div>
            <div className="flex items-center gap-2 min-w-0">
              <span className="truncate text-[13px] font-semibold text-fg">{label}</span>
              <span className="rounded-[4px] border border-line bg-base px-1.5 py-0.5 text-[10px] font-mono text-fg-subtle">
                {prismLang}
              </span>
            </div>
          </div>

          {/* Center / Right controls */}
          <div className="flex items-center gap-2.5">
            {/* Interpreter picker */}
            <div className="flex items-center gap-1.5">
              <span className="text-[11px] text-fg-subtle">Run with:</span>
              <select
                value={isKnownInterpreter ? interpreter : "custom…"}
                onKeyDown={(e) => e.stopPropagation()}
                onChange={(e) => {
                  beginEdit();
                  const choice = e.currentTarget.value;
                  updateNodeData(node.id, { interpreter: choice === "custom…" ? "" : choice });
                }}
                className="nodrag rounded-[5px] border border-line bg-base px-2 py-1 font-mono text-[11px] text-fg outline-none hover:border-line-strong focus:border-accent"
              >
                {COMMON_INTERPRETERS.map((opt) => (
                  <option key={opt} value={opt}>
                    {opt}
                  </option>
                ))}
              </select>
              {!isKnownInterpreter && (
                <input
                  value={interpreter}
                  placeholder="/usr/bin/env -S deno run"
                  onFocus={beginEdit}
                  onKeyDown={(e) => e.stopPropagation()}
                  onChange={(e) => updateNodeData(node.id, { interpreter: e.currentTarget.value })}
                  className="w-[170px] rounded-[5px] border border-line bg-base px-2 py-1 font-mono text-[11px] text-fg outline-none focus:border-accent"
                />
              )}
            </div>

            {/* Quick stats */}
            <div className="hidden sm:flex items-center gap-1 text-[11px] text-fg-subtle px-1">
              <span>{lineCount} {lineCount === 1 ? "line" : "lines"}</span>
              <span>·</span>
              <span>{script.length} chars</span>
            </div>

            {/* Copy button */}
            <button
              type="button"
              onClick={copyCode}
              disabled={!script}
              title="Copy script"
              className="flex items-center gap-1 rounded-[5px] border border-line bg-base px-2 py-1 text-[11px] font-medium text-fg-subtle transition hover:bg-hover hover:text-fg disabled:opacity-40"
            >
              {copied ? (
                <>
                  <Check size={12} className="text-success" />
                  <span className="text-success">Copied</span>
                </>
              ) : (
                <>
                  <Copy size={12} />
                  <span>Copy</span>
                </>
              )}
            </button>

            {/* Run Button */}
            <button
              type="button"
              onClick={handleRun}
              disabled={!script.trim() || isRunning}
              title="Run this script block (⌘R)"
              className={cn(
                "flex items-center gap-1.5 rounded-[5px] px-2.5 py-1 text-[11px] font-semibold transition cursor-pointer shadow-sm",
                isRunning
                  ? "bg-amber-500/20 text-amber-300 cursor-not-allowed"
                  : "bg-emerald-600 text-white hover:bg-emerald-500 active:scale-95",
                !script.trim() && "opacity-40 cursor-not-allowed",
              )}
            >
              {isRunning ? (
                <>
                  <Loader2 size={11} className="animate-spin" />
                  <span>Running…</span>
                </>
              ) : (
                <>
                  <Play size={10} fill="currentColor" />
                  <span>Run</span>
                </>
              )}
            </button>

            {/* Fullscreen toggle */}
            <button
              type="button"
              onClick={() => setIsFullscreen(!isFullscreen)}
              title={isFullscreen ? "Restore size" : "Maximize editor"}
              className="flex size-[26px] items-center justify-center rounded-[5px] text-fg-subtle transition hover:bg-hover hover:text-fg"
            >
              {isFullscreen ? <Minimize2 size={13} /> : <Maximize2 size={13} />}
            </button>

            {/* Close button */}
            <button
              type="button"
              onClick={close}
              title="Close editor (Esc)"
              className="flex size-[26px] items-center justify-center rounded-[5px] text-fg-subtle transition hover:bg-hover hover:text-fg"
            >
              <X size={14} />
            </button>
          </div>
        </div>

        {/* Editor Body */}
        <div className="relative flex flex-1 min-h-0 bg-base">
          {/* Line Numbers Gutter */}
          <div
            ref={gutterRef}
            className="select-none shrink-0 w-[46px] border-r border-line/60 bg-elevated/40 py-3 pr-2.5 text-right font-mono text-[12px] leading-[20px] text-fg-subtle/50 overflow-hidden"
          >
            {Array.from({ length: lineCount }, (_, i) => (
              <div key={i + 1}>{i + 1}</div>
            ))}
          </div>

          {/* Dual-layer Code Editor Container */}
          <div className="relative flex-1 min-w-0 h-full overflow-hidden">
            {/* Syntax Highlighted View Underneath */}
            <pre
              ref={preRef}
              aria-hidden="true"
              className="pointer-events-none absolute inset-0 m-0 overflow-hidden whitespace-pre font-mono text-[12.5px] leading-[20px] p-3 text-fg"
              style={{ tabSize: 2 }}
            >
              <code
                className={`language-${prismLang}`}
                dangerouslySetInnerHTML={{ __html: highlighted + (script.endsWith("\n") ? " " : "\n") }}
              />
            </pre>

            {/* Interactive Textarea on Top */}
            <textarea
              ref={textareaRef}
              value={script}
              rows={1}
              spellCheck={false}
              autoCapitalize="off"
              autoCorrect="off"
              onScroll={handleScroll}
              onFocus={beginEdit}
              onChange={(e) => {
                updateNodeData(node.id, { script: e.currentTarget.value });
              }}
              onKeyDown={handleKeyDown}
              placeholder={"#!/usr/bin/env bash\nset -euo pipefail\n\n# Write your script here…"}
              className="absolute inset-0 resize-none bg-transparent font-mono text-[12.5px] leading-[20px] p-3 outline-none text-transparent caret-fg selection:bg-accent/35 focus:outline-none whitespace-pre overflow-auto"
              style={{ tabSize: 2 }}
            />
          </div>
        </div>

        {/* Live Execution Results Console */}
        {(outputLines.length > 0 || isRunning || nodeStatus !== "idle") && (
          <div className="flex flex-col border-t border-line bg-[#090d13] transition-all">
            <div className="flex items-center justify-between border-b border-[#30363d]/80 bg-[#161b22] px-3.5 py-1.5 select-none">
              <div className="flex items-center gap-2">
                <span className="flex items-center gap-1.5 text-[11px] font-semibold text-[#c9d1d9]">
                  <Terminal size={12} className="text-accent" />
                  <span>Execution Output</span>
                </span>

                {nodeStatus === "running" || isRunning ? (
                  <span className="flex items-center gap-1 rounded bg-amber-500/20 px-1.5 py-0.2 font-mono text-[9.5px] font-bold text-amber-300 animate-pulse">
                    <Loader2 size={10} className="animate-spin" /> Running…
                  </span>
                ) : nodeStatus === "success" ? (
                  <span className="flex items-center gap-1 rounded bg-emerald-500/20 px-1.5 py-0.2 font-mono text-[9.5px] font-bold text-emerald-300">
                    <CheckCircle2 size={10} /> Succeeded (Exit 0)
                    {nodeMeta?.durationMs ? ` · ${formatDuration(nodeMeta.durationMs)}` : ""}
                  </span>
                ) : nodeStatus === "failed" ? (
                  <span className="flex items-center gap-1 rounded bg-rose-500/20 px-1.5 py-0.2 font-mono text-[9.5px] font-bold text-rose-300">
                    <XCircle size={10} /> Failed (Exit {nodeMeta?.exitCode ?? "≠0"})
                  </span>
                ) : null}
              </div>

              <div className="flex items-center gap-1">
                {node && outputLines.length > 0 && (
                  <button
                    type="button"
                    onClick={() => clearOutput(node.id)}
                    className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] text-fg-subtle hover:bg-hover hover:text-fg transition cursor-pointer"
                    title="Clear output"
                  >
                    <RotateCcw size={10} />
                    <span>Clear</span>
                  </button>
                )}

                <button
                  type="button"
                  onClick={() => setShowOutput(!showOutput)}
                  className="flex items-center gap-0.5 rounded px-1.5 py-0.5 text-[10px] text-fg-subtle hover:bg-hover hover:text-fg transition cursor-pointer"
                  title={showOutput ? "Collapse output" : "Expand output"}
                >
                  {showOutput ? <ChevronDown size={12} /> : <ChevronUp size={12} />}
                  <span>{showOutput ? "Hide" : "Show"}</span>
                </button>
              </div>
            </div>

            {showOutput && (
              <div
                ref={outputScrollRef}
                className="max-h-[160px] min-h-[70px] overflow-y-auto p-3 font-mono text-[11.5px] leading-[17px] text-[#c9d1d9] selectable"
              >
                {outputLines.length === 0 ? (
                  <div className="text-[11px] text-fg-subtle/60 italic">Waiting for script output…</div>
                ) : (
                  outputLines.map((line, idx) => (
                    <TerminalLine
                      key={`${line.at}-${idx}`}
                      text={line.text}
                      stream={line.stream}
                    />
                  ))
                )}
              </div>
            )}
          </div>
        )}

        {/* Footer */}
        <div className="flex h-[34px] shrink-0 items-center justify-between border-t border-line bg-elevated/60 px-4 text-[11px]">
          <div className="flex items-center gap-4 text-fg-subtle">
            <label className="flex cursor-pointer items-center gap-1.5 hover:text-fg">
              <input
                type="checkbox"
                checked={continueOnError}
                onChange={(e) => {
                  beginEdit();
                  updateNodeData(node.id, { continueOnError: e.currentTarget.checked });
                }}
                className="accent-[var(--color-accent)]"
              />
              <span>Carry on if this fails</span>
            </label>
            <span className="hidden md:inline text-fg-subtle/70">
              Interpolate upstream values with <code className="font-mono text-accent">{"{{VAR}}"}</code>
            </span>
          </div>

          <div className="flex items-center gap-2">
            <div className="hidden sm:flex items-center gap-2 text-fg-subtle/80">
              <span><kbd className="rounded border border-line bg-base px-1 py-0.5 font-mono text-[9.5px]">Tab</kbd> indent</span>
              <span><kbd className="rounded border border-line bg-base px-1 py-0.5 font-mono text-[9.5px]">⌘R</kbd> run</span>
              <span><kbd className="rounded border border-line bg-base px-1 py-0.5 font-mono text-[9.5px]">Esc</kbd> close</span>
              <span><kbd className="rounded border border-line bg-base px-1 py-0.5 font-mono text-[9.5px]">⌘↵</kbd> done</span>
            </div>
            <button
              type="button"
              onClick={close}
              className="rounded-[5px] bg-accent px-3 py-1 text-[11px] font-semibold text-white transition hover:bg-accent/90 cursor-pointer shadow-sm"
            >
              Done
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
