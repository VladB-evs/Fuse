import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Clock,
  Copy,
  Folder,
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
import { useWorkflowStore } from "@/store/workflowStore";
import { useUIStore } from "@/store/uiStore";
import { useRuntimeStore } from "@/store/runtimeStore";
import { runSingleNode } from "@/lib/actions";
import { highlightCode } from "@/lib/syntaxHighlight";
import { cn, formatDuration, prettyPath } from "@/lib/utils";
import { TerminalLine } from "@/components/ui/TerminalLine";
import type { WaitNodeType } from "@/types/workflow";

const PRESETS = [
  { label: "HTTP Health Check", cmd: "curl -fsS http://localhost:3000/health" },
  { label: "Port Open (nc)", cmd: "nc -z localhost 8080" },
  { label: "File Exists", cmd: 'test -f "dist/index.js"' },
  { label: "Docker Container Ready", cmd: "docker inspect -f '{{.State.Running}}' app-container" },
  { label: "PostgreSQL Ready", cmd: "pg_isready -h localhost -p 5432" },
];

export function WaitUntilEditorDialog() {
  const waitEditorNodeId = useUIStore((s) => s.waitEditorNodeId);
  if (!waitEditorNodeId) return null;
  return <WaitUntilEditorBody nodeId={waitEditorNodeId} />;
}

function WaitUntilEditorBody({ nodeId }: { nodeId: string }) {
  const closeWaitEditor = useUIStore((s) => s.closeWaitEditor);
  const notify = useUIStore((s) => s.notify);

  const nodes = useWorkflowStore((s) => s.nodes);
  const workflowDir = useWorkflowStore((s) => s.workingDir);
  const updateNodeData = useWorkflowStore((s) => s.updateNodeData);
  const beginEdit = useWorkflowStore((s) => s.beginEdit);

  // Runtime store for live output
  const outputLines = useRuntimeStore((s) => s.output[nodeId] ?? []);
  const nodeStatus = useRuntimeStore((s) => s.statuses[nodeId] ?? "idle");
  const nodeMeta = useRuntimeStore((s) => s.meta[nodeId]);
  const clearOutput = useRuntimeStore((s) => s.clearOutput);

  const [isFullscreen, setIsFullscreen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [isRunning, setIsRunning] = useState(false);
  const [showOutput, setShowOutput] = useState(true);

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const preRef = useRef<HTMLPreElement>(null);
  const lineNumbersRef = useRef<HTMLDivElement>(null);
  const outputScrollRef = useRef<HTMLDivElement>(null);

  const node = useMemo(
    () => nodes.find((n) => n.id === nodeId) as WaitNodeType | undefined,
    [nodes, nodeId],
  );

  const frame = useMemo(() => {
    if (!node?.data.frameId) return undefined;
    return nodes.find((n) => n.id === node.data.frameId);
  }, [nodes, node]);

  const workingDir = node?.data.workingDir ?? (frame?.data as any)?.workingDir ?? workflowDir;

  const code = node?.data.until ?? "";
  const label = node?.data.label ?? "Wait Condition";

  const lines = useMemo(() => {
    return code.split("\n");
  }, [code]);

  const lineCount = Math.max(lines.length, 1);

  // Auto-scroll output container as lines stream in
  useEffect(() => {
    if (outputScrollRef.current) {
      outputScrollRef.current.scrollTop = outputScrollRef.current.scrollHeight;
    }
  }, [outputLines.length, outputLines]);

  // Synchronize scroll between textarea, syntax layer, and line numbers
  const handleScroll = useCallback(() => {
    if (!textareaRef.current) return;
    const { scrollTop, scrollLeft } = textareaRef.current;
    if (preRef.current) {
      preRef.current.scrollTop = scrollTop;
      preRef.current.scrollLeft = scrollLeft;
    }
    if (lineNumbersRef.current) {
      lineNumbersRef.current.scrollTop = scrollTop;
    }
  }, []);

  const handleCodeChange = (newCode: string) => {
    beginEdit();
    updateNodeData(nodeId, { until: newCode });
  };

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      notify("Failed to copy command", "error");
    }
  };

  const handleRun = async () => {
    if (isRunning) return;
    setIsRunning(true);
    setShowOutput(true);
    notify(`Testing condition for "${label}"…`);
    try {
      await runSingleNode(nodeId);
    } finally {
      setIsRunning(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    e.stopPropagation();

    // ⌘R to test condition
    if ((e.metaKey || e.ctrlKey) && e.key === "r") {
      e.preventDefault();
      void handleRun();
      return;
    }

    // ⌘Enter to save & close
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
      e.preventDefault();
      closeWaitEditor();
      return;
    }

    // Escape to close
    if (e.key === "Escape") {
      e.preventDefault();
      closeWaitEditor();
      return;
    }

    // Tab handling (2 spaces)
    if (e.key === "Tab") {
      e.preventDefault();
      const textarea = e.currentTarget;
      const start = textarea.selectionStart;
      const end = textarea.selectionEnd;

      if (e.shiftKey) {
        const lineStart = code.lastIndexOf("\n", start - 1) + 1;
        if (code.slice(lineStart, lineStart + 2) === "  ") {
          const updated = code.slice(0, lineStart) + code.slice(lineStart + 2);
          handleCodeChange(updated);
          requestAnimationFrame(() => {
            textarea.selectionStart = Math.max(lineStart, start - 2);
            textarea.selectionEnd = Math.max(lineStart, end - 2);
          });
        }
      } else {
        const updated = code.substring(0, start) + "  " + code.substring(end);
        handleCodeChange(updated);
        requestAnimationFrame(() => {
          textarea.selectionStart = textarea.selectionEnd = start + 2;
        });
      }
    }
  };

  // Auto-focus on open
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.focus();
    }
  }, []);

  if (!node || node.type !== "wait") return null;

  const highlighted = highlightCode(code, "bash");
  const hasOutput = outputLines.length > 0 || isRunning || nodeStatus !== "idle";

  return (
    <div
      className="fixed inset-0 z-[65] flex items-center justify-center p-4 bg-canvas/70 backdrop-blur-[3px] animate-in fade-in duration-150"
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Escape") closeWaitEditor();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`Condition Editor: ${label}`}
        className={cn(
          "relative flex flex-col overflow-hidden rounded-xl border border-line-strong bg-base shadow-2xl transition-all duration-200",
          isFullscreen
            ? "fixed inset-4 w-auto h-auto max-w-none max-h-none"
            : "w-[800px] h-[600px] max-w-[calc(100vw-32px)] max-h-[calc(100vh-32px)]",
        )}
      >
        {/* Header Bar */}
        <header className="flex items-center justify-between border-b border-line bg-elevated/70 px-4 py-2.5 select-none">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="flex size-[24px] shrink-0 items-center justify-center rounded-[6px] bg-amber-500/15 text-amber-400">
              <Clock size={14} strokeWidth={2} />
            </div>
            <div className="flex items-center gap-2 min-w-0">
              <span className="truncate text-[13px] font-semibold text-fg">{label}</span>
              <span className="rounded-[4px] border border-amber-500/30 bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-mono font-bold text-amber-400">
                POLL UNTIL SUCCESS
              </span>
              {workingDir && (
                <span
                  className="hidden sm:flex items-center gap-1 truncate font-mono text-[11px] text-fg-subtle"
                  title={`Runs in ${workingDir}`}
                >
                  <Folder size={11} className="shrink-0" />
                  <span className="truncate">{prettyPath(workingDir)}</span>
                </span>
              )}
            </div>
          </div>

          <div className="flex items-center gap-1.5">
            {/* Run / Test Button */}
            <button
              type="button"
              onClick={() => void handleRun()}
              disabled={isRunning}
              className={cn(
                "flex items-center gap-1.5 rounded-[6px] px-2.5 py-1 text-[11px] font-semibold transition shadow-xs cursor-pointer",
                "bg-emerald-600 hover:bg-emerald-500 text-white active:bg-emerald-700 disabled:opacity-50",
              )}
              title="Test polling condition now (⌘R)"
            >
              {isRunning ? (
                <Loader2 size={12} className="animate-spin" />
              ) : (
                <Play size={12} fill="currentColor" />
              )}
              <span>Test Condition</span>
              <kbd className="ml-0.5 rounded bg-emerald-700/80 px-1 py-0.2 font-mono text-[9px] font-normal text-emerald-100">
                ⌘R
              </kbd>
            </button>

            <div className="mx-1 h-4 w-px bg-line" />

            {/* Copy Button */}
            <button
              type="button"
              onClick={() => void handleCopy()}
              className="flex size-[28px] items-center justify-center rounded-[6px] text-fg-subtle hover:bg-hover hover:text-fg transition cursor-pointer"
              title="Copy code"
            >
              {copied ? <Check size={13} className="text-success" /> : <Copy size={13} />}
            </button>

            {/* Fullscreen Toggle */}
            <button
              type="button"
              onClick={() => setIsFullscreen(!isFullscreen)}
              className="flex size-[28px] items-center justify-center rounded-[6px] text-fg-subtle hover:bg-hover hover:text-fg transition cursor-pointer"
              title={isFullscreen ? "Exit fullscreen" : "Fullscreen"}
            >
              {isFullscreen ? <Minimize2 size={13} /> : <Maximize2 size={13} />}
            </button>

            {/* Close Button */}
            <button
              type="button"
              onClick={closeWaitEditor}
              className="flex size-[28px] items-center justify-center rounded-[6px] text-fg-subtle hover:bg-hover hover:text-danger transition cursor-pointer"
              title="Close (Esc)"
            >
              <X size={14} />
            </button>
          </div>
        </header>

        {/* Preset Templates Bar */}
        <div className="flex items-center gap-1.5 overflow-x-auto border-b border-line/60 bg-elevated/40 px-3 py-1.5 text-[10.5px]">
          <span className="text-fg-subtle font-medium shrink-0 flex items-center gap-1">
            <Sparkles size={11} className="text-accent" /> Presets:
          </span>
          {PRESETS.map((preset) => (
            <button
              key={preset.label}
              type="button"
              onClick={() => handleCodeChange(preset.cmd)}
              className="shrink-0 rounded-[4px] border border-line/70 bg-base/80 px-2 py-0.5 font-mono text-[10px] text-fg-subtle transition hover:border-line-strong hover:bg-hover hover:text-fg cursor-pointer"
              title={`Use: ${preset.cmd}`}
            >
              {preset.label}
            </button>
          ))}
        </div>

        {/* Code Editor Body */}
        <div className="relative flex-1 flex min-h-0 bg-[#0d1117]">
          {/* Line Numbers Gutter */}
          <div
            ref={lineNumbersRef}
            aria-hidden="true"
            className="w-[44px] shrink-0 overflow-hidden select-none border-r border-[#30363d]/60 bg-[#090d13] py-3 text-right font-mono text-[11px] leading-[18px] text-[#484f58]"
          >
            {Array.from({ length: lineCount }, (_, i) => (
              <div key={i} className="pr-3">
                {i + 1}
              </div>
            ))}
          </div>

          {/* Editor Container */}
          <div className="relative flex-1 min-w-0 h-full overflow-hidden">
            {/* Syntax Highlighted Layer (Underneath) */}
            <pre
              ref={preRef}
              aria-hidden="true"
              className="pointer-events-none absolute inset-0 m-0 overflow-hidden p-3 font-mono text-[12px] leading-[18px] text-[#c9d1d9] whitespace-pre tab-size-2 select-none"
              style={{ tabSize: 2 }}
            >
              <code
                className="language-bash"
                dangerouslySetInnerHTML={{ __html: highlighted || " " }}
              />
            </pre>

            {/* Editable Textarea Layer (Top) */}
            <textarea
              ref={textareaRef}
              value={code}
              onChange={(e) => handleCodeChange(e.currentTarget.value)}
              onScroll={handleScroll}
              onKeyDown={handleKeyDown}
              placeholder="e.g. curl -fsS http://localhost:3000/health"
              spellCheck={false}
              autoCapitalize="off"
              autoCorrect="off"
              className={cn(
                "absolute inset-0 w-full h-full resize-none p-3 font-mono text-[12px] leading-[18px]",
                "bg-transparent text-transparent caret-white outline-none border-none",
                "overflow-auto whitespace-pre",
              )}
              style={{ tabSize: 2 }}
            />
          </div>
        </div>

        {/* Live Execution Results Console Section */}
        {hasOutput && (
          <div className="flex flex-col border-t border-line bg-[#090d13] transition-all">
            {/* Output Bar Header */}
            <div className="flex items-center justify-between border-b border-[#30363d]/80 bg-[#161b22] px-3.5 py-1.5 select-none">
              <div className="flex items-center gap-2">
                <span className="flex items-center gap-1.5 text-[11px] font-semibold text-[#c9d1d9]">
                  <Terminal size={12} className="text-accent" />
                  <span>Test Results</span>
                </span>

                {nodeStatus === "running" || isRunning ? (
                  <span className="flex items-center gap-1 rounded bg-amber-500/20 px-1.5 py-0.2 font-mono text-[9.5px] font-bold text-amber-300 animate-pulse">
                    <Loader2 size={10} className="animate-spin" /> Testing…
                  </span>
                ) : nodeStatus === "success" ? (
                  <span className="flex items-center gap-1 rounded bg-emerald-500/20 px-1.5 py-0.2 font-mono text-[9.5px] font-bold text-emerald-300">
                    <CheckCircle2 size={10} /> Passed (Exit 0)
                    {nodeMeta?.durationMs ? ` · ${formatDuration(nodeMeta.durationMs)}` : ""}
                  </span>
                ) : nodeStatus === "failed" ? (
                  <span className="flex items-center gap-1 rounded bg-rose-500/20 px-1.5 py-0.2 font-mono text-[9.5px] font-bold text-rose-300">
                    <XCircle size={10} /> Failed (Exit {nodeMeta?.exitCode ?? "≠0"})
                  </span>
                ) : null}
              </div>

              <div className="flex items-center gap-1">
                {outputLines.length > 0 && (
                  <button
                    type="button"
                    onClick={() => clearOutput(nodeId)}
                    className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] text-fg-subtle hover:bg-hover hover:text-fg transition cursor-pointer"
                    title="Clear console output"
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

            {/* Output Scroll Area */}
            {showOutput && (
              <div
                ref={outputScrollRef}
                className="max-h-[160px] min-h-[70px] overflow-y-auto p-3 font-mono text-[11.5px] leading-[17px] text-[#c9d1d9] selectable"
              >
                {outputLines.length === 0 ? (
                  <div className="text-[11px] text-fg-subtle/60 italic">Waiting for command output…</div>
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

        {/* Footer Bar */}
        <footer className="flex items-center justify-between border-t border-line bg-elevated/70 px-4 py-2 text-[11px] text-fg-subtle select-none">
          <div className="flex items-center gap-3">
            <span className="font-mono">
              {lineCount} {lineCount === 1 ? "line" : "lines"}
            </span>
            <span>·</span>
            <span className="flex items-center gap-1 font-mono text-emerald-400">
              <Terminal size={11} /> Shell command (polling until exit code 0)
            </span>
          </div>

          <div className="flex items-center gap-2">
            <span className="text-[10.5px]">
              <kbd className="rounded bg-hover px-1 py-0.5 font-mono text-[9.5px]">Tab</kbd> indent ·{" "}
              <kbd className="rounded bg-hover px-1 py-0.5 font-mono text-[9.5px]">⌘↵</kbd> done ·{" "}
              <kbd className="rounded bg-hover px-1 py-0.5 font-mono text-[9.5px]">Esc</kbd> close
            </span>
            <button
              type="button"
              onClick={closeWaitEditor}
              className="rounded-[6px] bg-accent px-3 py-1 text-[11px] font-semibold text-white hover:bg-accent-hover transition cursor-pointer shadow-xs"
            >
              Done
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
}
