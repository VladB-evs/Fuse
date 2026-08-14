import { useState, type ReactNode } from "react";
import { Handle } from "@xyflow/react";
import { Eject, Folder, Frame as FrameIcon, Play, X } from "lucide-react";
import { PORTS } from "@/canvas/ports";
import { useWorkflowStore } from "@/store/workflowStore";
import { useRuntimeStore } from "@/store/runtimeStore";
import { StatusBadge } from "@/components/ui/StatusDot";
import {
  chooseNodeDirectory,
  clearNodeDirectory,
  releaseBlockFromFrame,
  runSingleNode,
} from "@/lib/actions";
import { ACCENT_TEXT, ACCENT_TINT, catalogEntry } from "@/lib/catalog";
import { cn, formatDuration, prettyPath } from "@/lib/utils";
import { STATUS_LABEL } from "@/lib/status";
import {
  isFrameNode,
  type BlockKind,
  type FrameNodeType,
  type NodeRunState,
} from "@/types/workflow";

/**
 * The card every block that isn't a plain command is drawn in.
 *
 * Kind, icon and accent all come from the catalogue, so a block looks the same
 * here as it does in the picker that created it. Everything a block needs
 * regardless of kind — rename, eject, run, folder, status, ports — lives here;
 * each kind supplies only its own body.
 */
export function NodeShell({
  id,
  kind,
  label,
  frameId,
  selected,
  onRename,
  workingDir,
  runnable = true,
  ports,
  children,
}: {
  id: string;
  kind: BlockKind;
  label: string;
  frameId: string | null;
  selected: boolean;
  onRename: (label: string) => void;
  /** Omit for kinds that don't run anywhere in particular. */
  workingDir?: string | null;
  runnable?: boolean;
  /** Custom connection ports, for kinds that have more than one way out. */
  ports?: ReactNode;
  children: ReactNode;
}) {
  const entry = catalogEntry(kind);
  const Icon = entry.icon;

  const status = useRuntimeStore((s) => s.statuses[id] ?? "idle") as NodeRunState;
  const meta = useRuntimeStore((s) => s.meta[id]);
  const runActive = useRuntimeStore((s) => s.running);
  const beginEdit = useWorkflowStore((s) => s.beginEdit);

  const frame = useWorkflowStore((s) =>
    frameId ? s.nodes.find((n) => n.id === frameId && isFrameNode(n)) : undefined,
  ) as FrameNodeType | undefined;

  const [editingLabel, setEditingLabel] = useState(false);

  const waiting = status === "waiting";
  const statusLabel = (() => {
    if (status === "failed" && meta?.exitCode != null) return `Failed · exit ${meta.exitCode}`;
    if (status === "success" && meta?.durationMs != null) {
      return `Done · ${formatDuration(meta.durationMs)}`;
    }
    return STATUS_LABEL[status];
  })();

  return (
    <div className="group relative w-[288px]">
      <div
        className={cn(
          "fuse-card relative overflow-hidden rounded-node border bg-base",
          "transition-[border-color,box-shadow] duration-150 ease-out",
          "border-line",
          status === "skipped" && "opacity-55",
          status === "running" && "running-sheen border-accent/70",
          status === "success" && "border-success/35",
          status === "failed" && "border-danger/55",
          status === "cancelled" && "border-warn/45",
          // The one card holding everything up should be impossible to miss.
          waiting && "waiting-glow border-warn",
          selected && "border-accent shadow-[0_0_0_1px_var(--color-accent)]",
        )}
      >
        <div
          className={cn(
            "flex h-[30px] items-center gap-1.5 border-b border-line/70 px-2.5",
            ACCENT_TINT[entry.accent],
          )}
        >
          <Icon size={12} strokeWidth={1.75} className={cn("shrink-0", ACCENT_TEXT[entry.accent])} />

          {editingLabel ? (
            <input
              className="nodrag min-w-0 flex-1 bg-transparent text-[12px] font-medium text-fg outline-none"
              defaultValue={label}
              autoFocus
              onFocus={(e) => {
                beginEdit();
                e.currentTarget.select();
              }}
              onBlur={(e) => {
                onRename(e.currentTarget.value.trim() || entry.label);
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
              {label || entry.label}
            </span>
          )}

          <span className="shrink-0 text-[9.5px] tracking-wide text-fg-subtle uppercase">
            {entry.label}
          </span>

          {frameId && (
            <HeaderButton
              label={frame ? `Take out of “${frame.data.label}”` : "Take out of frame"}
              onClick={() => releaseBlockFromFrame(id)}
            >
              <Eject size={10} strokeWidth={2} />
            </HeaderButton>
          )}

          {runnable && (
            <HeaderButton
              label="Run this block"
              disabled={runActive}
              onClick={() => void runSingleNode(id)}
            >
              <Play size={9} fill="currentColor" strokeWidth={0} />
            </HeaderButton>
          )}
        </div>

        <div className="space-y-2 px-2.5 py-2.5">{children}</div>

        <div className="flex h-[26px] items-center gap-2 border-t border-line/70 px-2.5">
          {workingDir !== undefined && workingDir !== null ? (
            <span className="flex min-w-0 flex-1 items-center gap-1">
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  void chooseNodeDirectory(id);
                }}
                title={`Runs in ${workingDir}`}
                className="nodrag min-w-0 truncate font-mono text-[10px] text-fg-subtle hover:text-fg"
              >
                {prettyPath(workingDir)}
              </button>
              <button
                type="button"
                aria-label="Use the inherited folder"
                title="Use the inherited folder"
                onClick={(e) => {
                  e.stopPropagation();
                  clearNodeDirectory(id);
                }}
                className="nodrag shrink-0 rounded-[3px] p-px text-fg-subtle hover:bg-hover hover:text-fg"
              >
                <X size={9} strokeWidth={2} />
              </button>
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
          ) : workingDir !== undefined ? (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                void chooseNodeDirectory(id);
              }}
              title="Choose a folder for this step"
              className="nodrag flex min-w-0 flex-1 items-center gap-1 truncate text-[10px] text-fg-subtle hover:text-fg"
            >
              <Folder size={9} strokeWidth={1.75} className="shrink-0" />
              Set folder…
            </button>
          ) : (
            <span className="flex-1" />
          )}
          <StatusBadge status={status} label={statusLabel} />
        </div>
      </div>

      {ports ?? (
        <>
          {PORTS.map((port) => (
            <Handle
              key={port.id}
              id={port.id}
              type={port.type}
              position={port.position}
              className={`fuse-port fuse-port-${port.id}`}
            />
          ))}
        </>
      )}
    </div>
  );
}

function HeaderButton({
  label,
  onClick,
  disabled,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      className={cn(
        "nodrag flex size-[18px] shrink-0 items-center justify-center rounded-[5px]",
        "text-fg-subtle opacity-0 transition hover:bg-hover hover:text-fg",
        "group-hover:opacity-100 focus-visible:opacity-100",
        "disabled:pointer-events-none",
      )}
    >
      {children}
    </button>
  );
}

// --- Field primitives -----------------------------------------------------
//
// Shared so every block's body reads the same way: a label on the left, the
// thing you edit on the right, and no chrome competing with the canvas.

/** Stop canvas shortcuts firing while a field has focus. */
function fieldKeys(
  event: React.KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>,
  multiline = false,
) {
  if (event.key === "Escape") {
    event.currentTarget.blur();
    return;
  }
  if (!multiline && event.key === "Enter") {
    event.currentTarget.blur();
    return;
  }
  if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) return;
  event.stopPropagation();
}

export function TextField({
  label,
  value,
  placeholder,
  mono = true,
  invalid = false,
  width = 52,
  onChange,
  onCommit,
}: {
  label?: string;
  value: string;
  placeholder?: string;
  mono?: boolean;
  invalid?: boolean;
  width?: number;
  onChange: (value: string) => void;
  onCommit: () => void;
}) {
  return (
    <div className="flex items-center gap-1.5">
      {label && (
        <span className="shrink-0 text-[10.5px] text-fg-subtle" style={{ width }}>
          {label}
        </span>
      )}
      <input
        value={value}
        placeholder={placeholder}
        spellCheck={false}
        autoCapitalize="off"
        autoCorrect="off"
        onFocus={onCommit}
        onChange={(e) => onChange(e.currentTarget.value)}
        onKeyDown={(e) => fieldKeys(e)}
        className={cn(
          "nodrag min-w-0 flex-1 rounded-[4px] border bg-elevated/60 px-1.5 py-1",
          "text-[10.5px] text-fg outline-none focus:border-accent",
          mono && "font-mono",
          invalid ? "border-warn/50" : "border-line",
        )}
      />
    </div>
  );
}

export function CodeArea({
  value,
  placeholder,
  rows = 4,
  onChange,
  onCommit,
}: {
  value: string;
  placeholder: string;
  rows?: number;
  onChange: (value: string) => void;
  onCommit: () => void;
}) {
  return (
    <textarea
      value={value}
      rows={rows}
      spellCheck={false}
      autoCapitalize="off"
      autoCorrect="off"
      placeholder={placeholder}
      onFocus={onCommit}
      onChange={(e) => onChange(e.currentTarget.value)}
      onKeyDown={(e) => fieldKeys(e, true)}
      className={cn(
        "nodrag nowheel max-h-[220px] w-full resize-none rounded-[5px] border border-line",
        "bg-elevated/50 px-1.5 py-1 font-mono text-[11px] leading-[16px] text-fg outline-none",
        "focus:border-accent placeholder:text-fg-subtle/70",
      )}
    />
  );
}

export function Toggle({
  checked,
  children,
  onChange,
}: {
  checked: boolean;
  children: ReactNode;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="flex cursor-pointer items-center gap-1.5 text-[10.5px] text-fg-muted">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.currentTarget.checked)}
        className="nodrag accent-[var(--color-accent)]"
      />
      {children}
    </label>
  );
}

export function Choices({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: string[];
  onChange: (value: string) => void;
}) {
  return (
    <div className="flex items-center gap-1.5">
      <span className="w-[52px] shrink-0 text-[10.5px] text-fg-subtle">{label}</span>
      <select
        value={options.includes(value) ? value : options[0]}
        onChange={(e) => onChange(e.currentTarget.value)}
        onKeyDown={(e) => e.stopPropagation()}
        className={cn(
          "nodrag min-w-0 flex-1 rounded-[4px] border border-line bg-elevated/60 px-1 py-1",
          "font-mono text-[10.5px] text-fg outline-none focus:border-accent",
        )}
      >
        {options.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
    </div>
  );
}

/** A one-line note under a body, for hints and validation alike. */
export function Note({ tone = "muted", children }: { tone?: "muted" | "warn"; children: ReactNode }) {
  return (
    <p className={cn("text-[10px]", tone === "warn" ? "text-warn/90" : "text-fg-subtle")}>
      {children}
    </p>
  );
}
