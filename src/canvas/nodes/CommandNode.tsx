import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Handle, type NodeProps } from "@xyflow/react";
import { PORTS } from "@/canvas/ports";
import {
  ChevronDown,
  Eject,
  Folder,
  Frame as FrameIcon,
  Play,
  Plus,
  Power,
  Settings2,
  TerminalSquare,
  Variable,
  X,
} from "lucide-react";
import { useWorkflowStore } from "@/store/workflowStore";
import { useRuntimeStore } from "@/store/runtimeStore";
import { useUIStore } from "@/store/uiStore";
import { StatusBadge } from "@/components/ui/StatusDot";
import { TerminalLine } from "@/components/ui/TerminalLine";
import {
  chooseNodeDirectory,
  clearNodeDirectory,
  releaseBlockFromFrame,
  runSingleNode,
} from "@/lib/actions";
import { cn, formatDuration, prettyPath } from "@/lib/utils";
import { STATUS_LABEL } from "@/lib/status";
import { placeholdersIn } from "@/lib/placeholders";
import { useAvailableVariables } from "@/lib/useAvailableVariables";
import { isFrameNode, type CommandNodeType, type FrameNodeType } from "@/types/workflow";

const MAX_COMMAND_HEIGHT = 148;
const TAIL_LINES = 3;

function CommandNodeImpl({ id, data, selected }: NodeProps<CommandNodeType>) {
  const status = useRuntimeStore((s) => s.statuses[id] ?? "idle");
  const meta = useRuntimeStore((s) => s.meta[id]);
  const lines = useRuntimeStore((s) => s.output[id]);
  const runActive = useRuntimeStore((s) => s.running);

  const updateNodeData = useWorkflowStore((s) => s.updateNodeData);
  const beginEdit = useWorkflowStore((s) => s.beginEdit);

  // The frame this block belongs to, so the footer can say where it will run.
  const frame = useWorkflowStore((s) =>
    data.frameId ? s.nodes.find((n) => n.id === data.frameId && isFrameNode(n)) : undefined,
  ) as FrameNodeType | undefined;

  const pendingFocusId = useUIStore((s) => s.pendingFocusId);
  const consumeFocus = useUIStore((s) => s.consumeFocus);

  const [editingLabel, setEditingLabel] = useState(false);
  const [showOptions, setShowOptions] = useState(false);
  const [pickerOpen, setPickerOpen] = useState<string | null>(null); // placeholder name or "__insert__"
  const commandRef = useRef<HTMLTextAreaElement>(null);

  // Close variable picker when clicking outside or pressing Escape
  useEffect(() => {
    if (!pickerOpen) return;
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!target.closest("[data-variable-picker]")) {
        setPickerOpen(null);
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setPickerOpen(null);
      }
    };
    window.addEventListener("mousedown", handleClickOutside);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("mousedown", handleClickOutside);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [pickerOpen]);

  const autoGrow = useCallback(() => {
    const el = commandRef.current;
    if (!el) return;
    el.style.height = "0px";
    el.style.height = `${Math.min(el.scrollHeight, MAX_COMMAND_HEIGHT)}px`;
  }, []);

  useLayoutEffect(autoGrow, [data.command, autoGrow]);

  // A freshly added block should be ready to type into immediately.
  useEffect(() => {
    if (pendingFocusId !== id) return;
    commandRef.current?.focus();
    consumeFocus();
  }, [pendingFocusId, id, consumeFocus]);

  // Values this block will ask for at run time.
  const inputs = useMemo(() => placeholdersIn(data.command), [data.command]);
  const availableVars = useAvailableVariables();

  /** Replace a specific placeholder name everywhere in the command. */
  const replaceVariable = useCallback(
    (oldName: string, newName: string) => {
      const pattern = new RegExp(`\\{\\{\\s*${oldName}\\s*\\}\\}`, "g");
      beginEdit();
      updateNodeData(id, {
        command: data.command.replace(pattern, `{{${newName}}}`),
      });
      setPickerOpen(null);
    },
    [id, data.command, beginEdit, updateNodeData],
  );

  /** Insert a variable reference at the end of the command. */
  const insertVariable = useCallback(
    (varName: string) => {
      beginEdit();
      const separator = data.command && !data.command.endsWith(" ") ? " " : "";
      updateNodeData(id, {
        command: `${data.command}${separator}"{{${varName}}}"`,
      });
      setPickerOpen(null);
    },
    [id, data.command, beginEdit, updateNodeData],
  );

  const isRunning = status === "running";
  const disabled = !!data.disabled;
  const tail = isRunning && lines ? lines.slice(-TAIL_LINES) : [];

  const statusLabel = (() => {
    if (status === "failed" && meta?.exitCode != null) return `Failed · exit ${meta.exitCode}`;
    if (status === "success" && meta?.durationMs != null) {
      return `Success · ${formatDuration(meta.durationMs)}`;
    }
    return STATUS_LABEL[status];
  })();

  return (
    // The outer wrapper must not clip: the connection bands hang a few pixels
    // outside the card so they can be grabbed from just beyond the border.
    <div className={cn("group relative w-[288px]", pickerOpen && "!z-50")}>
      <div
        className={cn(
          "fuse-card relative rounded-node border bg-base",
          "transition-[border-color,box-shadow,opacity,filter] duration-150 ease-out",
          status === "idle" && "border-line",
          status === "pending" && "border-line",
          status === "skipped" && "border-line opacity-55",
          isRunning && "border-accent/70",
          status === "success" && "border-success/35",
          status === "failed" && "border-danger/55",
          status === "cancelled" && "border-warn/45",
          disabled && "opacity-50 grayscale brightness-90 border-dashed border-line/60",
          selected && "border-accent shadow-[0_0_0_1px_var(--color-accent)]",
        )}
      >
        {/* Clipped shimmer effect when running — isolated so it doesn't bleed onto the canvas */}
        {isRunning && (
          <div className="running-sheen pointer-events-none absolute inset-0 overflow-hidden rounded-node" />
        )}

        {/* Header — double-click the name to rename. */}
        <div className="flex h-[30px] items-center gap-1.5 border-b border-line/70 px-2.5 rounded-t-[calc(var(--radius-node)-1px)]">
          <TerminalSquare size={12} className="shrink-0 text-fg-subtle" strokeWidth={1.75} />

          {editingLabel ? (
            <input
              className="nodrag min-w-0 flex-1 bg-transparent text-[12px] font-medium text-fg outline-none"
              defaultValue={data.label}
              autoFocus
              onFocus={(e) => {
                beginEdit();
                e.currentTarget.select();
              }}
              onBlur={(e) => {
                updateNodeData(id, { label: e.currentTarget.value.trim() || "Terminal" });
                setEditingLabel(false);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === "Escape") e.currentTarget.blur();
                e.stopPropagation();
              }}
            />
          ) : (
            <span
              className="min-w-0 flex-1 truncate text-[12px] font-medium text-fg"
              onDoubleClick={() => setEditingLabel(true)}
              title="Double-click to rename"
            >
              {data.label || "Terminal"}
            </span>
          )}

          {disabled && (
            <button
              type="button"
              title="Step is disabled. Click to re-enable."
              onClick={(e) => {
                e.stopPropagation();
                useWorkflowStore.getState().toggleNodeDisabled(id);
              }}
              className="nodrag flex shrink-0 items-center gap-1.5 rounded-full bg-accent px-2.5 py-0.5 text-[9.5px] font-bold text-white shadow-[0_0_10px_rgba(91,108,255,0.6)] hover:bg-accent/90 hover:scale-105 active:scale-95 transition-all cursor-pointer"
            >
              <Power size={9} strokeWidth={2.8} />
              <span>Enable</span>
            </button>
          )}

          {inputs.length > 0 && !disabled && (
            <span
              title={`Asks for ${inputs.join(", ")} before running`}
              className="flex shrink-0 items-center gap-1 rounded-[4px] bg-accent/12 px-1.5 py-0.5 text-[9.5px] font-medium text-accent"
            >
              <Variable size={8} strokeWidth={2.5} />
              {inputs.length}
            </span>
          )}

          <button
            type="button"
            aria-label="Step options"
            aria-expanded={showOptions}
            title="Step options: folder, environment, error handling"
            onClick={(e) => {
              e.stopPropagation();
              setShowOptions((open) => !open);
            }}
            className={cn(
              "nodrag flex size-[18px] shrink-0 items-center justify-center rounded-[5px]",
              "text-fg-subtle opacity-0 transition hover:bg-hover hover:text-fg",
              "group-hover:opacity-100 focus-visible:opacity-100",
              showOptions && "bg-hover text-fg opacity-100",
            )}
          >
            <Settings2 size={10} strokeWidth={2} />
          </button>

          {/* The way out of a frame. Dragging never removes a block, so this
              button is the only thing that does — and it says so. */}
          {data.frameId && (
            <button
              type="button"
              aria-label="Take out of frame"
              title={frame ? `Take out of “${frame.data.label}”` : "Take out of frame"}
              onClick={(e) => {
                e.stopPropagation();
                releaseBlockFromFrame(id);
              }}
              className={cn(
                "nodrag flex size-[18px] shrink-0 items-center justify-center rounded-[5px]",
                "text-fg-subtle opacity-0 transition hover:bg-hover hover:text-fg",
                "group-hover:opacity-100 focus-visible:opacity-100",
              )}
            >
              <Eject size={10} strokeWidth={2} />
            </button>
          )}

          <button
            type="button"
            aria-label="Run this block"
            title="Run this block"
            disabled={runActive || disabled}
            onClick={(e) => {
              e.stopPropagation();
              void runSingleNode(id);
            }}
            className={cn(
              "nodrag flex size-[18px] shrink-0 items-center justify-center rounded-[5px]",
              "text-fg-subtle opacity-0 transition hover:bg-hover hover:text-fg",
              "group-hover:opacity-100 focus-visible:opacity-100",
              "disabled:pointer-events-none",
            )}
          >
            <Play size={9} fill="currentColor" strokeWidth={0} />
          </button>
        </div>

        {/* Command */}
        <div className="flex gap-1.5 px-2.5 py-2.5">
          <span className="select-none pt-[1px] font-mono text-[12px] leading-[17px] text-fg-subtle">
            $
          </span>
          <textarea
            ref={commandRef}
            value={data.command}
            rows={1}
            spellCheck={false}
            autoCapitalize="off"
            autoCorrect="off"
            placeholder="Type a command…"
            className={cn(
              "nodrag nowheel min-w-0 flex-1 resize-none bg-transparent",
              "font-mono text-[12px] leading-[17px] text-fg outline-none",
              "placeholder:text-fg-subtle/70",
            )}
            onFocus={beginEdit}
            onChange={(e) => {
              updateNodeData(id, { command: e.currentTarget.value });
              autoGrow();
            }}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                e.currentTarget.blur();
                return;
              }
              // Let ⌘↵ bubble up to the global "run workflow" shortcut.
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) return;

              if (e.key === "Backspace" || e.key === "Delete") {
                const { nodes, edges } = useWorkflowStore.getState();
                const selectedNodes = nodes.filter((n) => n.selected);
                const selectedEdges = edges.filter((e) => e.selected);
                if (
                  selectedNodes.length > 1 ||
                  selectedNodes.some((n) => n.type === "frame") ||
                  selectedEdges.length > 0
                ) {
                  e.currentTarget.blur();
                  e.preventDefault();
                  useWorkflowStore.getState().deleteSelected();
                  return;
                }
              }

              e.stopPropagation();
            }}
          />
        </div>

        {/* Variable picker strip */}
        {(inputs.length > 0 || availableVars.length > 0) && (
          <div className="nodrag flex flex-wrap items-center gap-1 border-t border-line/50 px-2.5 py-1.5">
            {inputs.map((name) => {
              const bound = availableVars.some((v) => v.name === name);
              return (
                <div key={name} className="relative" data-variable-picker>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      setPickerOpen(pickerOpen === name ? null : name);
                    }}
                    className={cn(
                      "flex items-center gap-1 rounded-[4px] px-1.5 py-[2px] text-[10px] font-mono transition cursor-pointer",
                      bound
                        ? "bg-success/12 text-success hover:bg-success/20"
                        : "bg-warn/12 text-warn hover:bg-warn/20",
                    )}
                    title={bound ? `Linked to {{${name}}}` : `Click to bind {{${name}}} to a variable`}
                  >
                    <Variable size={8} strokeWidth={2.5} />
                    {name}
                    <ChevronDown size={8} />
                  </button>

                  {pickerOpen === name && availableVars.length > 0 && (
                    <div className="absolute left-0 top-full z-50 mt-1 min-w-[190px] max-w-[260px] max-h-[190px] overflow-y-auto rounded-[6px] border border-line bg-base shadow-2xl py-1">
                      {availableVars.map((v) => (
                        <button
                          key={v.name}
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            replaceVariable(name, v.name);
                          }}
                          className={cn(
                            "flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-[11px] transition hover:bg-hover cursor-pointer",
                            v.name === name && "bg-accent/10 text-accent",
                          )}
                        >
                          <Variable size={10} className="shrink-0 text-fg-subtle" />
                          <span className="font-mono font-medium text-fg">{v.name}</span>
                          <span className="ml-auto truncate text-[9.5px] text-fg-subtle">{v.sourceLabel}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}

            {/* Insert new variable button */}
            {availableVars.length > 0 && (
              <div className="relative" data-variable-picker>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    setPickerOpen(pickerOpen === "__insert__" ? null : "__insert__");
                  }}
                  className="flex items-center gap-0.5 rounded-[4px] px-1.5 py-[2px] text-[10px] text-fg-subtle transition hover:bg-hover hover:text-fg cursor-pointer"
                  title="Insert a variable"
                >
                  <Plus size={9} strokeWidth={2.5} />
                  <Variable size={9} strokeWidth={2} />
                </button>

                {pickerOpen === "__insert__" && (
                  <div className="absolute left-0 top-full z-50 mt-1 min-w-[190px] max-w-[260px] max-h-[190px] overflow-y-auto rounded-[6px] border border-line bg-base shadow-2xl py-1">
                    {availableVars
                      .filter((v) => !inputs.includes(v.name))
                      .map((v) => (
                        <button
                          key={v.name}
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            insertVariable(v.name);
                          }}
                          className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-[11px] transition hover:bg-hover cursor-pointer"
                        >
                          <Variable size={10} className="shrink-0 text-fg-subtle" />
                          <span className="font-mono font-medium text-fg">{v.name}</span>
                          <span className="ml-auto truncate text-[9.5px] text-fg-subtle">{v.sourceLabel}</span>
                        </button>
                      ))}
                    {availableVars.filter((v) => !inputs.includes(v.name)).length === 0 && (
                      <div className="px-2.5 py-1.5 text-[10.5px] text-fg-subtle">All variables already used</div>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {showOptions && (
          <StepOptions
            data={data}
            beginEdit={beginEdit}
            onChange={(patch) => updateNodeData(id, patch)}
            onChooseFolder={() => void chooseNodeDirectory(id)}
            onClearFolder={() => clearNodeDirectory(id)}
          />
        )}

        {/* Live output tail while running */}
        {tail.length > 0 && (
          <div className="animate-in-soft space-y-[1px] border-t border-line/70 bg-elevated/45 px-2.5 py-1.5">
            {tail.map((line, index) => (
              <TerminalLine
                key={`${line.at}-${index}`}
                text={line.text}
                stream={line.stream}
                className="truncate !text-[10.5px] !leading-[15px] !whitespace-pre"
              />
            ))}
          </div>
        )}

        {/* Footer — where this block will actually run, and how it last did. */}
        <div className="flex h-[26px] items-center gap-2 border-t border-line/70 px-2.5">
          {data.workingDir ? (
            <span className="min-w-0 flex-1 truncate font-mono text-[10px] text-fg-subtle">
              {data.workingDir}
            </span>
          ) : frame ? (
            <span
              className="flex min-w-0 flex-1 items-center gap-1 truncate text-[10px] text-accent/80"
              title={
                frame.data.workingDir
                  ? `In frame “${frame.data.label}” — runs in ${frame.data.workingDir}`
                  : `In frame “${frame.data.label}” — no folder set yet`
              }
            >
              <FrameIcon size={9} strokeWidth={2} className="shrink-0" />
              <span className="truncate font-mono">
                {frame.data.workingDir ? prettyPath(frame.data.workingDir) : frame.data.label}
              </span>
            </span>
          ) : (
            <span className="flex-1" />
          )}
          <StatusBadge status={status} label={statusLabel} />
        </div>
      </div>

      {/* Connection bands. Each side of the card is one long grab target, so a
          wire can be pulled from anywhere along an edge — and dropped anywhere
          on another block. */}
      {PORTS.map((port) => (
        <Handle
          key={port.id}
          id={port.id}
          type={port.type}
          position={port.position}
          className={`fuse-port fuse-port-${port.id}`}
        />
      ))}
    </div>
  );
}

function StepOptions({
  data,
  beginEdit,
  onChange,
  onChooseFolder,
  onClearFolder,
}: {
  data: CommandNodeType["data"];
  beginEdit: () => void;
  onChange: (patch: Partial<CommandNodeType["data"]>) => void;
  onChooseFolder: () => void;
  onClearFolder: () => void;
}) {
  const entries = Object.entries(data.env);
  const replaceEntry = (oldKey: string, key: string, value: string) => {
    const next = { ...data.env };
    delete next[oldKey];
    if (key.trim()) next[key.trim()] = value;
    onChange({ env: next });
  };

  return (
    <div className="nodrag border-t border-line/70 bg-elevated/35 px-2.5 py-2">
      <div className="flex items-center gap-1.5">
        <Folder size={10} className="shrink-0 text-fg-subtle" />
        <span className="text-[10.5px] text-fg-subtle">Run folder</span>
        <button
          type="button"
          onClick={onChooseFolder}
          className="min-w-0 flex-1 truncate rounded-[4px] px-1.5 py-0.5 text-left font-mono text-[10.5px] text-accent transition hover:bg-hover"
          title="Choose a folder for only this step"
        >
          {data.workingDir ? prettyPath(data.workingDir) : "Inherit from frame or workflow…"}
        </button>
        {data.workingDir && (
          <button type="button" onClick={onClearFolder} title="Use inherited folder" className="rounded-[4px] p-0.5 text-fg-subtle hover:bg-hover hover:text-fg">
            <X size={10} strokeWidth={2} />
          </button>
        )}
      </div>

      <label className="mt-2 flex cursor-pointer items-center gap-1.5 text-[10.5px] text-fg-muted">
        <input
          type="checkbox"
          checked={data.continueOnError}
          onChange={(event) => {
            beginEdit();
            onChange({ continueOnError: event.currentTarget.checked });
          }}
          className="accent-[var(--color-accent)]"
        />
        Continue dependent steps if this command fails
      </label>

      <div className="mt-2 border-t border-line/60 pt-1.5">
        <div className="mb-1 flex items-center justify-between">
          <span className="text-[10.5px] text-fg-subtle">Environment variables</span>
          <button
            type="button"
            onClick={() => {
              beginEdit();
              let key = "NEW_VAR";
              let index = 2;
              while (data.env[key] !== undefined) key = `NEW_VAR_${index++}`;
              onChange({ env: { ...data.env, [key]: "" } });
            }}
            className="flex items-center gap-0.5 rounded-[4px] px-1 py-0.5 text-[10px] text-accent hover:bg-hover"
          >
            <Plus size={9} strokeWidth={2.5} /> Add
          </button>
        </div>
        {entries.length === 0 ? (
          <p className="text-[10px] text-fg-subtle/80">Inherited shell environment only.</p>
        ) : (
          <div className="space-y-1">
            {entries.map(([key, value]) => (
              <div key={key} className="flex items-center gap-1">
                <input
                  value={key}
                  aria-label="Environment variable name"
                  spellCheck={false}
                  onFocus={beginEdit}
                  onChange={(event) => replaceEntry(key, event.currentTarget.value, value)}
                  className="min-w-0 w-[36%] rounded-[4px] border border-line bg-base px-1.5 py-1 font-mono text-[10px] text-fg outline-none focus:border-accent"
                />
                <span className="text-[10px] text-fg-subtle">=</span>
                <input
                  value={value}
                  aria-label={`Value for ${key}`}
                  spellCheck={false}
                  onFocus={beginEdit}
                  onChange={(event) => onChange({ env: { ...data.env, [key]: event.currentTarget.value } })}
                  className="min-w-0 flex-1 rounded-[4px] border border-line bg-base px-1.5 py-1 font-mono text-[10px] text-fg outline-none focus:border-accent"
                />
                <button
                  type="button"
                  aria-label={`Remove ${key}`}
                  onClick={() => replaceEntry(key, "", "")}
                  className="rounded-[4px] p-0.5 text-fg-subtle hover:bg-hover hover:text-danger"
                >
                  <X size={10} strokeWidth={2} />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
      <div className="mt-1.5 flex items-center gap-1 text-[9.5px] text-fg-subtle/75">
        <ChevronDown size={9} /> Values apply only to this step.
      </div>
    </div>
  );
}

export const CommandNode = memo(CommandNodeImpl);
