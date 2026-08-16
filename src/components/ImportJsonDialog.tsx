import { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertCircle,
  Braces,
  CheckCircle2,
  ClipboardPaste,
  FilePlus2,
  FolderInput,
  Layers,
  RefreshCw,
  Trash2,
  Workflow,
  X,
  Sparkles,
} from "lucide-react";
import { useUIStore } from "@/store/uiStore";
import { useWorkflowStore } from "@/store/workflowStore";
import { parseFuseJson, sanitizeJsonText, type ParsedFuseData } from "@/lib/jsonImporter";
import { importJsonString, type ImportJsonMode } from "@/lib/actions";
import { Button } from "./ui/Button";
import { cn } from "@/lib/utils";

type DialogValidation = {
  valid: boolean;
  empty?: boolean;
  error?: string;
  data?: ParsedFuseData;
};

export function ImportJsonDialog() {
  const open = useUIStore((s) => s.importJsonOpen);
  const setOpen = useUIStore((s) => s.setImportJsonOpen);
  const notify = useUIStore((s) => s.notify);
  const currentNodesCount = useWorkflowStore((s) => s.nodes.length);

  const [rawText, setRawText] = useState("");
  const [loading, setLoading] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Auto-focus and try to check clipboard when opened if textarea is empty
  useEffect(() => {
    if (open) {
      setTimeout(() => {
        textareaRef.current?.focus();
      }, 50);
    }
  }, [open]);

  const validation: DialogValidation = useMemo(() => {
    if (!rawText.trim()) return { valid: false, empty: true };
    return parseFuseJson(rawText);
  }, [rawText]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!open) return;
      if (e.key === "Escape") {
        e.preventDefault();
        setOpen(false);
      }
      if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
        e.preventDefault();
        if (validation.valid && validation.data) {
          void handleImport(validation.data.kind === "workflow" ? "new_workflow" : "insert_blocks");
        }
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [open, validation]);

  if (!open) return null;

  const handlePasteClipboard = async () => {
    try {
      if (!navigator.clipboard || !navigator.clipboard.readText) {
        notify("Clipboard access is not available", "error");
        return;
      }
      const clip = await navigator.clipboard.readText();
      if (!clip || !clip.trim()) {
        notify("Clipboard is empty", "error");
        return;
      }
      setRawText(clip);
    } catch {
      notify("Failed to read from clipboard", "error");
    }
  };

  const handleFormatJson = () => {
    try {
      const sanitized = sanitizeJsonText(rawText);
      const obj = JSON.parse(sanitized);
      setRawText(JSON.stringify(obj, null, 2));
    } catch {
      notify("Cannot format invalid JSON", "error");
    }
  };

  const handleImport = async (mode: ImportJsonMode) => {
    if (!validation.valid || !validation.data) return;
    setLoading(true);
    try {
      const success = await importJsonString(rawText, mode);
      if (success) {
        setOpen(false);
        setRawText("");
      }
    } finally {
      setLoading(false);
    }
  };

  const kindLabel =
    validation.data?.kind === "workflow"
      ? "Full Workflow Document"
      : validation.data?.kind === "single_node"
        ? "Single Block"
        : "Block Collection";

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) setOpen(false);
      }}
    >
      <div className="absolute inset-0 bg-canvas/55 backdrop-blur-[2px]" aria-hidden />

      <div className="animate-in-soft relative flex h-full max-h-[86vh] w-full max-w-[720px] flex-col rounded-xl border border-line-strong bg-base shadow-[0_18px_50px_-12px_rgba(0,0,0,0.8)] overflow-hidden">
        {/* Header */}
        <div className="flex shrink-0 items-center justify-between border-b border-line px-5 py-3.5">
          <div className="flex items-center gap-2.5">
            <span className="flex size-7 items-center justify-center rounded-[6px] bg-accent/15 text-accent">
              <Braces size={16} />
            </span>
            <div>
              <h2 className="text-[14px] font-semibold tracking-tight text-fg">
                Import JSON
              </h2>
              <p className="text-[11px] text-fg-subtle">
                Paste JSON text directly or load from clipboard without creating a file.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="flex size-7 items-center justify-center rounded-[6px] text-fg-subtle transition hover:bg-hover hover:text-fg"
            title="Close (Escape)"
          >
            <X size={15} />
          </button>
        </div>

        {/* Text Input & Controls Area */}
        <div className="flex flex-1 flex-col overflow-y-auto p-5 space-y-4">
          <div className="flex items-center justify-between">
            <label htmlFor="json-import-textarea" className="text-[11px] font-medium uppercase tracking-wide text-fg-subtle">
              JSON Content / Markdown snippet
            </label>
            <div className="flex items-center gap-2">
              <Button
                variant="subtle"
                onClick={handlePasteClipboard}
                title="Paste text from clipboard"
                className="h-6 text-[11px] px-2"
              >
                <ClipboardPaste size={12} />
                Paste Clipboard
              </Button>
              {rawText && (
                <>
                  <Button
                    variant="ghost"
                    onClick={handleFormatJson}
                    title="Format JSON with indenting"
                    className="h-6 text-[11px] px-2 text-fg-subtle"
                  >
                    <Sparkles size={12} />
                    Prettify
                  </Button>
                  <Button
                    variant="ghost"
                    onClick={() => setRawText("")}
                    title="Clear content"
                    className="h-6 text-[11px] px-2 text-fg-subtle hover:text-danger"
                  >
                    <Trash2 size={12} />
                    Clear
                  </Button>
                </>
              )}
            </div>
          </div>

          <div className="relative flex-1 min-h-[220px]">
            <textarea
              id="json-import-textarea"
              ref={textareaRef}
              value={rawText}
              onChange={(e) => setRawText(e.target.value)}
              placeholder={`{\n  "nodes": [\n    {\n      "type": "command",\n      "data": { "command": "echo Hello world", "label": "Say Hello" }\n    }\n  ],\n  "edges": []\n}`}
              spellCheck={false}
              autoCapitalize="off"
              autoCorrect="off"
              className="h-full w-full resize-none rounded-lg border border-line bg-canvas/70 p-3.5 font-mono text-[12px] leading-[18px] text-fg outline-none transition focus:border-accent/70 focus:bg-canvas"
            />
          </div>

          {/* Validation & Preview Card */}
          <div
            className={cn(
              "rounded-lg border p-3 transition text-[12px]",
              validation.empty
                ? "border-line-subtle bg-elevated/20 text-fg-subtle"
                : validation.valid
                  ? "border-emerald-500/30 bg-emerald-500/10 text-fg"
                  : "border-danger/30 bg-danger/10 text-danger",
            )}
          >
            {validation.empty ? (
              <p className="flex items-center gap-2 text-fg-subtle">
                <Workflow size={14} className="shrink-0" />
                Supports full workflows, partial block exports, node lists, or markdown ```json fences.
              </p>
            ) : validation.valid && validation.data ? (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5 font-medium text-emerald-400">
                    <CheckCircle2 size={15} className="shrink-0" />
                    <span>Valid {kindLabel}</span>
                    {validation.data.name && (
                      <span className="text-fg font-semibold">“{validation.data.name}”</span>
                    )}
                  </div>
                  <div className="flex items-center gap-2 text-[11px] text-fg-muted font-mono">
                    <span className="rounded bg-base px-1.5 py-0.5 border border-line">
                      {validation.data.nodes.length} block{validation.data.nodes.length === 1 ? "" : "s"}
                    </span>
                    <span className="rounded bg-base px-1.5 py-0.5 border border-line">
                      {validation.data.edges.length} wire{validation.data.edges.length === 1 ? "" : "s"}
                    </span>
                  </div>
                </div>

                {/* Summary badges */}
                <div className="flex flex-wrap gap-1.5 pt-1">
                  {Object.entries(validation.data.blockSummary).map(([k, count]) => (
                    <span
                      key={k}
                      className="inline-flex items-center gap-1 rounded-[5px] bg-base/80 border border-line px-2 py-0.5 text-[10.5px] text-fg-muted"
                    >
                      <Layers size={10} className="text-fg-subtle" />
                      <span className="capitalize">{k}</span>
                      <span className="text-fg-subtle font-mono">×{Number(count)}</span>
                    </span>
                  ))}
                </div>
              </div>
            ) : (
              <div className="flex items-start gap-2">
                <AlertCircle size={15} className="shrink-0 mt-0.5 text-danger" />
                <div className="min-w-0 flex-1">
                  <span className="font-medium">Validation error: </span>
                  <span className="text-[11.5px]">{validation.error}</span>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Footer actions */}
        <div className="flex shrink-0 items-center justify-between border-t border-line bg-elevated/30 px-5 py-3.5">
          <div className="text-[11px] text-fg-subtle">
            {validation.valid ? "Press ⌘↵ to import" : "Enter valid JSON to enable import options"}
          </div>

          <div className="flex items-center gap-2">
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>

            {validation.valid && (
              <>
                <Button
                  variant="subtle"
                  disabled={loading}
                  onClick={() => handleImport("insert_blocks")}
                  title="Add imported blocks directly into your current canvas"
                >
                  <FolderInput size={13} />
                  Add to Current Canvas
                </Button>

                {currentNodesCount > 0 && (
                  <Button
                    variant="subtle"
                    disabled={loading}
                    onClick={() => handleImport("replace_current")}
                    title="Replace the contents of current canvas with this JSON"
                    className="text-amber-400 hover:text-amber-300"
                  >
                    <RefreshCw size={12} />
                    Replace Canvas
                  </Button>
                )}

                <Button
                  variant="primary"
                  disabled={loading}
                  onClick={() => handleImport("new_workflow")}
                  title="Save and open as a completely new workflow"
                >
                  <FilePlus2 size={13} />
                  Open as New Workflow
                </Button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
