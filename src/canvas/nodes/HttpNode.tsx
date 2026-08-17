import { memo, useMemo } from "react";
import { type NodeProps } from "@xyflow/react";
import { Maximize2, Plus, Sparkles, X } from "lucide-react";
import { useWorkflowStore } from "@/store/workflowStore";
import { useUIStore } from "@/store/uiStore";
import { NodeShell, TextField, Toggle, fieldKeys } from "./NodeShell";
import { highlightCode } from "@/lib/syntaxHighlight";
import { cn } from "@/lib/utils";
import type { HttpNodeType } from "@/types/workflow";

const METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD"];
const TAKES_BODY = new Set(["POST", "PUT", "PATCH", "DELETE"]);

const METHOD_THEMES: Record<string, { active: string; inactive: string }> = {
  GET: {
    active: "bg-emerald-500/20 text-emerald-400 border-emerald-500/40",
    inactive: "hover:bg-emerald-500/10 hover:text-emerald-300",
  },
  POST: {
    active: "bg-blue-500/20 text-blue-400 border-blue-500/40",
    inactive: "hover:bg-blue-500/10 hover:text-blue-300",
  },
  PUT: {
    active: "bg-violet-500/20 text-violet-400 border-violet-500/40",
    inactive: "hover:bg-violet-500/10 hover:text-violet-300",
  },
  PATCH: {
    active: "bg-amber-500/20 text-amber-400 border-amber-500/40",
    inactive: "hover:bg-amber-500/10 hover:text-amber-300",
  },
  DELETE: {
    active: "bg-rose-500/20 text-rose-400 border-rose-500/40",
    inactive: "hover:bg-rose-500/10 hover:text-rose-300",
  },
  HEAD: {
    active: "bg-slate-500/20 text-slate-300 border-slate-500/40",
    inactive: "hover:bg-slate-500/10 hover:text-slate-300",
  },
};

const HEADER_PRESETS = [
  { name: "+ Auth Bearer", key: "Authorization", value: "Bearer {{TOKEN}}" },
  { name: "+ JSON", key: "Content-Type", value: "application/json" },
  { name: "+ Accept JSON", key: "Accept", value: "application/json" },
];

/**
 * An HTTP request as a first-class step.
 *
 * It goes out through `curl`, so proxies, certificates and `~/.curlrc` behave
 * as they do everywhere else on the machine — and the response can be kept
 * under a name, which is what makes it composable with the rest.
 */
function HttpNodeImpl({ id, data, selected }: NodeProps<HttpNodeType>) {
  const updateNodeData = useWorkflowStore((s) => s.updateNodeData);
  const beginEdit = useWorkflowStore((s) => s.beginEdit);
  const openHttpEditor = useUIStore((s) => s.openHttpEditor);
  const notify = useUIStore((s) => s.notify);

  const currentMethod = (data.method || "GET").toUpperCase();
  const headers = Object.entries(data.headers || {});
  const hasBody = TAKES_BODY.has(currentMethod);
  const body = data.body || "";
  const lines = body ? body.split("\n").length : 0;

  const isJson = useMemo(() => {
    const trimmed = body.trim();
    return trimmed.startsWith("{") || trimmed.startsWith("[");
  }, [body]);

  const highlighted = useMemo(
    () => highlightCode(body, isJson ? "json" : "markdown"),
    [body, isJson],
  );

  const replaceHeader = (oldKey: string, nextKey: string, nextValue: string) => {
    beginEdit();
    const next: Record<string, string> = {};
    for (const [k, v] of headers) {
      if (k === oldKey) {
        if (nextKey) next[nextKey] = nextValue;
      } else {
        next[k] = v;
      }
    }
    if (!oldKey && nextKey) next[nextKey] = nextValue;
    updateNodeData(id, { headers: next });
  };

  const addPresetHeader = (key: string, value: string) => {
    beginEdit();
    updateNodeData(id, { headers: { ...data.headers, [key]: value } });
  };

  const formatJsonBody = () => {
    if (!body.trim()) return;
    try {
      const parsed = JSON.parse(body);
      const formatted = JSON.stringify(parsed, null, 2);
      beginEdit();
      updateNodeData(id, { body: formatted });
      notify("JSON formatted");
    } catch {
      notify("Cannot format: invalid JSON", "error");
    }
  };

  return (
    <NodeShell
      id={id}
      kind="http"
      label={data.label}
      frameId={data.frameId}
      selected={!!selected}
      onRename={(label) => updateNodeData(id, { label })}
    >
      {/* Color-Coded Method Selector */}
      <div>
        <label className="mb-1 block text-[10.5px] font-medium text-fg-subtle">Method</label>
        <div className="nodrag grid grid-cols-6 gap-1 rounded-[6px] border border-line bg-elevated/40 p-0.5">
          {METHODS.map((m) => {
            const isActive = m === currentMethod;
            const theme = METHOD_THEMES[m] ?? METHOD_THEMES["GET"]!;
            return (
              <button
                key={m}
                type="button"
                onClick={() => {
                  beginEdit();
                  updateNodeData(id, { method: m });
                }}
                className={cn(
                  "rounded-[4px] py-1 text-center font-mono text-[10px] font-bold transition cursor-pointer border border-transparent",
                  isActive ? theme.active : cn("text-fg-subtle", theme.inactive),
                )}
              >
                {m}
              </button>
            );
          })}
        </div>
      </div>

      {/* URL Field */}
      <TextField
        label="URL"
        value={data.url}
        placeholder="https://api.example.com/items"
        invalid={data.url.trim() === ""}
        onCommit={beginEdit}
        onChange={(url) => updateNodeData(id, { url })}
      />

      {/* Headers Section */}
      <div className="border-t border-line/60 pt-1.5">
        <div className="mb-1 flex items-center justify-between">
          <span className="text-[10.5px] font-medium text-fg-subtle">Headers</span>
          <button
            type="button"
            onClick={() => {
              beginEdit();
              let key = "Header";
              let index = 1;
              while (data.headers && data.headers[`${key}-${index}`] !== undefined) index++;
              updateNodeData(id, { headers: { ...data.headers, [`${key}-${index}`]: "" } });
            }}
            className="nodrag flex items-center gap-0.5 rounded-[4px] px-1 py-0.5 text-[10px] font-medium text-accent hover:bg-hover cursor-pointer"
          >
            <Plus size={10} strokeWidth={2.5} /> Add header
          </button>
        </div>

        {/* Quick Presets */}
        <div className="nodrag mb-1.5 flex flex-wrap gap-1">
          {HEADER_PRESETS.map((preset) => (
            <button
              key={preset.key}
              type="button"
              onClick={() => addPresetHeader(preset.key, preset.value)}
              className="rounded-[4px] border border-line/70 bg-elevated/60 px-1.5 py-0.5 text-[9.5px] font-mono text-fg-subtle transition hover:border-line-strong hover:bg-hover hover:text-fg cursor-pointer"
              title={`Add ${preset.key}`}
            >
              {preset.name}
            </button>
          ))}
        </div>

        {headers.length === 0 ? (
          <p className="text-[10px] text-fg-subtle/80 italic">
            None. JSON bodies automatically get Content-Type: application/json.
          </p>
        ) : (
          <div className="space-y-1">
            {headers.map(([key, value]) => (
              <div key={key} className="flex items-center gap-1">
                <input
                  value={key}
                  aria-label="Header name"
                  spellCheck={false}
                  onFocus={beginEdit}
                  onChange={(e) => replaceHeader(key, e.currentTarget.value, value)}
                  onKeyDown={(e) => fieldKeys(e)}
                  className={FIELD}
                />
                <span className="text-[10px] text-fg-subtle">:</span>
                <input
                  value={value}
                  aria-label={`Value for ${key}`}
                  spellCheck={false}
                  onFocus={beginEdit}
                  onChange={(e) =>
                    updateNodeData(id, {
                      headers: { ...data.headers, [key]: e.currentTarget.value },
                    })
                  }
                  onKeyDown={(e) => fieldKeys(e)}
                  className={cn(FIELD, "flex-1")}
                />
                <button
                  type="button"
                  aria-label={`Remove ${key}`}
                  onClick={() => replaceHeader(key, "", "")}
                  className="nodrag rounded-[4px] p-0.5 text-fg-subtle hover:bg-hover hover:text-danger cursor-pointer"
                >
                  <X size={10} strokeWidth={2} />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Body Preview with Expand Dialog Trigger */}
      {hasBody && (
        <div className="border-t border-line/60 pt-1.5">
          <div className="group/code relative rounded-[5px] border border-line bg-elevated/40 overflow-hidden">
            <div className="flex items-center justify-between border-b border-line/60 bg-elevated/70 px-2 py-1">
              <span className="text-[10px] font-mono text-fg-subtle">
                Body ({isJson ? "json" : "raw"}) · {lines === 0 ? "empty" : `${lines} line${lines === 1 ? "" : "s"}`}
              </span>
              <div className="flex items-center gap-1">
                {body.trim() && (
                  <button
                    type="button"
                    onClick={formatJsonBody}
                    className="nodrag flex items-center gap-0.5 rounded-[4px] px-1.5 py-0.5 text-[9.5px] font-medium text-fg-subtle hover:bg-hover hover:text-fg cursor-pointer transition"
                    title="Format JSON"
                  >
                    <Sparkles size={9} className="text-accent" />
                    <span>Format</span>
                  </button>
                )}
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    openHttpEditor(id);
                  }}
                  className="nodrag flex items-center gap-1 rounded-[4px] px-1.5 py-0.5 text-[10px] font-medium text-accent hover:bg-hover hover:text-fg cursor-pointer transition"
                  title="Open full expanded payload editor"
                >
                  <Maximize2 size={10} />
                  <span>Expand</span>
                </button>
              </div>
            </div>

            <div
              onClick={(e) => {
                e.stopPropagation();
                openHttpEditor(id);
              }}
              className="nodrag nowheel min-h-[72px] max-h-[140px] overflow-auto p-2 cursor-pointer transition hover:bg-elevated/70 select-none"
              title="Click to open full payload editor"
            >
              {body.trim() ? (
                <pre
                  aria-hidden="true"
                  className="m-0 whitespace-pre font-mono text-[11px] leading-[16px] text-fg"
                  style={{ tabSize: 2 }}
                >
                  <code
                    className={`language-${isJson ? "json" : "markdown"}`}
                    dangerouslySetInnerHTML={{ __html: highlighted }}
                  />
                </pre>
              ) : (
                <div className="flex h-[56px] items-center justify-center text-center text-[10.5px] font-mono text-fg-subtle/60 italic">
                  Empty body — click to write JSON…
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Keep Response As */}
      <TextField
        label="Keep response as"
        value={data.variable}
        placeholder="RESPONSE (e.g. USER_DATA)"
        onCommit={beginEdit}
        onChange={(variable) => updateNodeData(id, { variable })}
      />

      <Toggle
        checked={data.failOnErrorStatus}
        onChange={(failOnErrorStatus) => {
          beginEdit();
          updateNodeData(id, { failOnErrorStatus });
        }}
      >
        Fail on 4xx and 5xx
      </Toggle>

      <Toggle
        checked={data.continueOnError ?? false}
        onChange={(continueOnError) => {
          beginEdit();
          updateNodeData(id, { continueOnError });
        }}
      >
        Continue on error
      </Toggle>
    </NodeShell>
  );
}

const FIELD =
  "nodrag min-w-0 w-[38%] rounded-[4px] border border-line bg-elevated/60 px-1.5 py-1 font-mono text-[10px] text-fg outline-none focus:border-accent";

export const HttpNode = memo(HttpNodeImpl);
