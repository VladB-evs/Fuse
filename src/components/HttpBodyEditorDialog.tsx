import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Copy,
  Globe,
  Loader2,
  Maximize2,
  Minimize2,
  Play,
  RotateCcw,
  Sparkles,
  Terminal,
  X,
  XCircle,
} from "lucide-react";
import { useUIStore } from "@/store/uiStore";
import { useWorkflowStore } from "@/store/workflowStore";
import { useRuntimeStore } from "@/store/runtimeStore";
import { runSingleNode } from "@/lib/actions";
import { highlightCode } from "@/lib/syntaxHighlight";
import { cn, formatDuration } from "@/lib/utils";
import { TerminalLine } from "@/components/ui/TerminalLine";
import type { HttpNodeType } from "@/types/workflow";

const METHOD_COLORS: Record<string, { badge: string; border: string }> = {
  GET: { badge: "bg-emerald-500/15 text-emerald-400", border: "border-emerald-500/30" },
  POST: { badge: "bg-blue-500/15 text-blue-400", border: "border-blue-500/30" },
  PUT: { badge: "bg-violet-500/15 text-violet-400", border: "border-violet-500/30" },
  PATCH: { badge: "bg-amber-500/15 text-amber-400", border: "border-amber-500/30" },
  DELETE: { badge: "bg-rose-500/15 text-rose-400", border: "border-rose-500/30" },
  HEAD: { badge: "bg-slate-500/15 text-slate-400", border: "border-slate-500/30" },
};

export function HttpBodyEditorDialog() {
  const httpEditorNodeId = useUIStore((s) => s.httpEditorNodeId);
  if (!httpEditorNodeId) return null;
  return <HttpBodyEditorBody nodeId={httpEditorNodeId} />;
}

function HttpBodyEditorBody({ nodeId }: { nodeId: string }) {
  const close = useUIStore((s) => s.closeHttpEditor);
  const notify = useUIStore((s) => s.notify);
  const isRunning = useRuntimeStore((s) => s.running);

  const node = useWorkflowStore((s) =>
    s.nodes.find((n) => n.id === nodeId),
  ) as HttpNodeType | undefined;

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

  const body = node?.data.body ?? "";
  const method = (node?.data.method ?? "POST").toUpperCase();
  const url = node?.data.url ?? "";
  const label = node?.data.label ?? "HTTP Request";

  const isJson = useMemo(() => {
    const trimmed = body.trim();
    return trimmed.startsWith("{") || trimmed.startsWith("[");
  }, [body]);

  const lang = isJson ? "json" : "markdown";
  const highlighted = useMemo(() => highlightCode(body, lang), [body, lang]);

  const lineCount = useMemo(() => {
    return Math.max(1, body.split("\n").length);
  }, [body]);

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
    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        close();
      }
    };
    window.addEventListener("keydown", handleGlobalKeyDown);
    return () => window.removeEventListener("keydown", handleGlobalKeyDown);
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

  const formatJson = useCallback(() => {
    if (!node || !body.trim()) return;
    try {
      const parsed = JSON.parse(body);
      const formatted = JSON.stringify(parsed, null, 2);
      beginEdit();
      updateNodeData(node.id, { body: formatted });
      notify("JSON formatted successfully");
    } catch {
      notify("Cannot format: invalid JSON syntax", "error");
    }
  }, [node, body, beginEdit, updateNodeData, notify]);

  const handleRun = useCallback(async () => {
    if (!node) return;
    try {
      await runSingleNode(node.id);
    } catch (err) {
      console.error(err);
    }
  }, [node]);

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

      // Format JSON on Cmd+Shift+F / Ctrl+Shift+F
      if (e.key.toLowerCase() === "f" && (e.metaKey || e.ctrlKey) && e.shiftKey) {
        e.preventDefault();
        formatJson();
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
            updateNodeData(node.id, { body: nextVal });
            setTimeout(() => {
              textarea.selectionStart = Math.max(lineStart, start - 2);
              textarea.selectionEnd = Math.max(lineStart, end - 2);
            }, 0);
          }
        } else {
          // Indent with 2 spaces
          const nextVal = val.substring(0, start) + "  " + val.substring(end);
          updateNodeData(node.id, { body: nextVal });
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

        // Extra indent after lines ending in { or [
        const extra = /[[{]\s*$/.test(currentLine) ? "  " : "";
        const insertion = "\n" + indent + extra;

        const nextVal = val.substring(0, start) + insertion + val.substring(textarea.selectionEnd);
        updateNodeData(node.id, { body: nextVal });
        setTimeout(() => {
          textarea.selectionStart = textarea.selectionEnd = start + insertion.length;
        }, 0);
        return;
      }
    },
    [node, close, beginEdit, updateNodeData, handleRun, formatJson],
  );

  const copyCode = useCallback(() => {
    if (!body) return;
    navigator.clipboard.writeText(body);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }, [body]);

  if (!node || node.type !== "http") return null;

  const colorScheme = METHOD_COLORS[method] ?? METHOD_COLORS["GET"]!;

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
            : "h-[580px] max-h-[88vh] w-[820px] max-w-[94vw]",
        )}
      >
        {/* Header */}
        <div className="flex h-[46px] shrink-0 items-center justify-between border-b border-line bg-elevated/70 px-4">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="flex size-[24px] shrink-0 items-center justify-center rounded-[6px] bg-accent/15 text-accent">
              <Globe size={14} strokeWidth={2} />
            </div>
            <div className="flex items-center gap-2 min-w-0">
              <span className="truncate text-[13px] font-semibold text-fg">{label}</span>
              <span
                className={cn(
                  "rounded-[4px] border px-1.5 py-0.5 text-[10px] font-mono font-bold tracking-wider",
                  colorScheme.badge,
                  colorScheme.border,
                )}
              >
                {method}
              </span>
              {url && (
                <span className="hidden sm:inline max-w-[260px] truncate text-[11px] font-mono text-fg-subtle">
                  {url}
                </span>
              )}
            </div>
          </div>

          {/* Center / Right controls */}
          <div className="flex items-center gap-2">
            {/* Format JSON */}
            <button
              type="button"
              onClick={formatJson}
              disabled={!body.trim()}
              title="Prettify JSON payload (⌘⇧F)"
              className="flex items-center gap-1 rounded-[5px] border border-line bg-base px-2 py-1 text-[11px] font-medium text-fg-subtle transition hover:bg-hover hover:text-fg disabled:opacity-40"
            >
              <Sparkles size={12} className="text-accent" />
              <span>Format JSON</span>
            </button>

            {/* Quick stats */}
            <div className="hidden md:flex items-center gap-1 text-[11px] text-fg-subtle px-1">
              <span>{lineCount} {lineCount === 1 ? "line" : "lines"}</span>
              <span>·</span>
              <span>{body.length} chars</span>
            </div>

            {/* Copy button */}
            <button
              type="button"
              onClick={copyCode}
              disabled={!body}
              title="Copy request payload"
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

            {/* Run / Send Request Button */}
            <button
              type="button"
              onClick={handleRun}
              disabled={isRunning}
              title="Send HTTP request (⌘R)"
              className={cn(
                "flex items-center gap-1.5 rounded-[5px] px-2.5 py-1 text-[11px] font-semibold transition cursor-pointer shadow-sm",
                isRunning
                  ? "bg-amber-500/20 text-amber-300 cursor-not-allowed"
                  : "bg-emerald-600 text-white hover:bg-emerald-500 active:scale-95",
              )}
            >
              {isRunning ? (
                <>
                  <Loader2 size={11} className="animate-spin" />
                  <span>Sending…</span>
                </>
              ) : (
                <>
                  <Play size={10} fill="currentColor" />
                  <span>Send</span>
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
                className={`language-${lang}`}
                dangerouslySetInnerHTML={{ __html: highlighted + (body.endsWith("\n") ? " " : "\n") }}
              />
            </pre>

            {/* Interactive Textarea on Top */}
            <textarea
              ref={textareaRef}
              value={body}
              rows={1}
              spellCheck={false}
              autoCapitalize="off"
              autoCorrect="off"
              onScroll={handleScroll}
              onFocus={beginEdit}
              onChange={(e) => {
                updateNodeData(node.id, { body: e.currentTarget.value });
              }}
              onKeyDown={handleKeyDown}
              placeholder={'{\n  "key": "value",\n  "user": "{{USER}}"\n}'}
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
                  <span>HTTP Response</span>
                </span>

                {nodeStatus === "running" || isRunning ? (
                  <span className="flex items-center gap-1 rounded bg-blue-500/20 px-1.5 py-0.2 font-mono text-[9.5px] font-bold text-blue-300 animate-pulse">
                    <Loader2 size={10} className="animate-spin" /> Sending…
                  </span>
                ) : nodeStatus === "success" ? (
                  <span className="flex items-center gap-1 rounded bg-emerald-500/20 px-1.5 py-0.2 font-mono text-[9.5px] font-bold text-emerald-300">
                    <CheckCircle2 size={10} /> {nodeMeta?.exitCode != null ? `HTTP ${nodeMeta.exitCode}` : "Success"}
                    {nodeMeta?.durationMs ? ` · ${formatDuration(nodeMeta.durationMs)}` : ""}
                  </span>
                ) : nodeStatus === "failed" ? (
                  <span className="flex items-center gap-1 rounded bg-rose-500/20 px-1.5 py-0.2 font-mono text-[9.5px] font-bold text-rose-300">
                    <XCircle size={10} /> Failed ({nodeMeta?.exitCode != null ? `HTTP ${nodeMeta.exitCode}` : "Error"})
                  </span>
                ) : null}
              </div>

              <div className="flex items-center gap-1">
                {node && outputLines.length > 0 && (
                  <button
                    type="button"
                    onClick={() => clearOutput(node.id)}
                    className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] text-fg-subtle hover:bg-hover hover:text-fg transition cursor-pointer"
                    title="Clear response output"
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
                  <div className="text-[11px] text-fg-subtle/60 italic">Waiting for HTTP response…</div>
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
            <span className="text-fg-subtle/80">
              Interpolate upstream values with <code className="font-mono text-accent">{"{{VAR}}"}</code>
            </span>
          </div>

          <div className="flex items-center gap-2">
            <div className="hidden sm:flex items-center gap-2 text-fg-subtle/80">
              <span><kbd className="rounded border border-line bg-base px-1 py-0.5 font-mono text-[9.5px]">Tab</kbd> indent</span>
              <span><kbd className="rounded border border-line bg-base px-1 py-0.5 font-mono text-[9.5px]">⌘R</kbd> send</span>
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
