import { memo, useEffect, useRef, useState } from "react";
import { Handle, type NodeProps } from "@xyflow/react";
import {
  Download,
  FileSearch,
  FlaskConical,
  Folder,
  FolderPlus,
  GripVertical,
  LayoutDashboard,
  MoreHorizontal,
  Pencil,
  Play,
  RotateCcw,
  X,
  Zap,
} from "lucide-react";
import { useWorkflowStore } from "@/store/workflowStore";
import { useRuntimeStore } from "@/store/runtimeStore";
import { useUIStore } from "@/store/uiStore";
import { runFrame, exportFrame, chooseFrameDirectory, clearFrameDirectory } from "@/lib/actions";
import { autoLayoutFrame } from "@/lib/layout";
import { membersOf } from "@/lib/frames";
import { cn } from "@/lib/utils";
import { PORTS } from "../ports";
import type { FrameNodeType, FrameColor } from "@/types/workflow";

export const FRAME_THEMES: Record<
  FrameColor,
  {
    name: string;
    border: string;
    borderActive: string;
    bg: string;
    bgHover: string;
    headerBg: string;
    headerBorder: string;
    badge: string;
    text: string;
    accent: string;
    dot: string;
  }
> = {
  default: {
    name: "Default (Slate)",
    border: "border-line-strong",
    borderActive: "border-accent/80",
    bg: "bg-white/[0.015]",
    bgHover: "bg-accent/[0.09]",
    headerBg: "bg-elevated",
    headerBorder: "border-line",
    badge: "bg-surface text-fg-muted border-line/60",
    text: "text-fg",
    accent: "bg-accent hover:bg-accent-hover text-white",
    dot: "#71717a",
  },
  blue: {
    name: "Blue (API / Backend)",
    border: "border-blue-500/35",
    borderActive: "border-blue-500",
    bg: "bg-blue-500/[0.035]",
    bgHover: "bg-blue-500/[0.09]",
    headerBg: "bg-[#0b1329]",
    headerBorder: "border-blue-500/40",
    badge: "bg-blue-500/15 text-blue-300 border-blue-500/30",
    text: "text-blue-100",
    accent: "bg-blue-600 hover:bg-blue-500 text-white",
    dot: "#3b82f6",
  },
  green: {
    name: "Green (Web / Frontend)",
    border: "border-emerald-500/35",
    borderActive: "border-emerald-500",
    bg: "bg-emerald-500/[0.035]",
    bgHover: "bg-emerald-500/[0.09]",
    headerBg: "bg-[#081f18]",
    headerBorder: "border-emerald-500/40",
    badge: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
    text: "text-emerald-100",
    accent: "bg-emerald-600 hover:bg-emerald-500 text-white",
    dot: "#10b981",
  },
  purple: {
    name: "Purple (Infra / Docker)",
    border: "border-purple-500/35",
    borderActive: "border-purple-500",
    bg: "bg-purple-500/[0.035]",
    bgHover: "bg-purple-500/[0.09]",
    headerBg: "bg-[#190c2e]",
    headerBorder: "border-purple-500/40",
    badge: "bg-purple-500/15 text-purple-300 border-purple-500/30",
    text: "text-purple-100",
    accent: "bg-purple-600 hover:bg-purple-500 text-white",
    dot: "#a855f7",
  },
  amber: {
    name: "Amber (Scripts / DB)",
    border: "border-amber-500/35",
    borderActive: "border-amber-500",
    bg: "bg-amber-500/[0.035]",
    bgHover: "bg-amber-500/[0.09]",
    headerBg: "bg-[#241705]",
    headerBorder: "border-amber-500/40",
    badge: "bg-amber-500/15 text-amber-300 border-amber-500/30",
    text: "text-amber-100",
    accent: "bg-amber-600 hover:bg-amber-500 text-white",
    dot: "#f59e0b",
  },
  rose: {
    name: "Rose (Deploy / Release)",
    border: "border-rose-500/35",
    borderActive: "border-rose-500",
    bg: "bg-rose-500/[0.035]",
    bgHover: "bg-rose-500/[0.09]",
    headerBg: "bg-[#260914]",
    headerBorder: "border-rose-500/40",
    badge: "bg-rose-500/15 text-rose-300 border-rose-500/30",
    text: "text-rose-100",
    accent: "bg-rose-600 hover:bg-rose-500 text-white",
    dot: "#f43f5e",
  },
  cyan: {
    name: "Cyan (Testing / CI)",
    border: "border-cyan-500/35",
    borderActive: "border-cyan-500",
    bg: "bg-cyan-500/[0.035]",
    bgHover: "bg-cyan-500/[0.09]",
    headerBg: "bg-[#061c24]",
    headerBorder: "border-cyan-500/40",
    badge: "bg-cyan-500/15 text-cyan-300 border-cyan-500/30",
    text: "text-cyan-100",
    accent: "bg-cyan-600 hover:bg-cyan-500 text-white",
    dot: "#06b6d4",
  },
};

const COLOR_KEYS: FrameColor[] = ["default", "blue", "green", "purple", "amber", "rose", "cyan"];

/**
 * A frame is a named folder wrapped around a set of blocks, with its own Run.
 *
 * It has no resize handles: the rectangle is computed from the blocks inside
 * it, so it always hugs its contents. Dragging anywhere on it moves the frame
 * and everything it holds — the blocks sit on a layer above, so a click that
 * lands on a block still goes to the block.
 */
function FrameNodeImpl({ id, data, selected }: NodeProps<FrameNodeType>) {
  const beginEdit = useWorkflowStore((s) => s.beginEdit);
  const updateFrameData = useWorkflowStore((s) => s.updateFrameData);

  const memberCount = useWorkflowStore((s) => membersOf(id, s.nodes).length);
  const runActive = useRuntimeStore((s) => s.running);
  const isDropTarget = useUIStore((s) => s.dropFrameId === id);

  const [editingLabel, setEditingLabel] = useState(false);
  const [showColorPicker, setShowColorPicker] = useState(false);
  const [showMoreMenu, setShowMoreMenu] = useState(false);

  const labelRef = useRef<HTMLInputElement>(null);
  const colorPickerRef = useRef<HTMLDivElement>(null);
  const moreMenuRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const colorKey: FrameColor = data.color && data.color in FRAME_THEMES ? data.color : "default";
  const theme = FRAME_THEMES[colorKey];

  useEffect(() => {
    if (editingLabel) labelRef.current?.select();
  }, [editingLabel]);

  // Elevate this frame's stacking context above all block nodes while a menu is open
  useEffect(() => {
    const parentNode = containerRef.current?.closest(".react-flow__node") as HTMLElement | null;
    if (!parentNode) return;
    if (showMoreMenu || showColorPicker) {
      parentNode.style.zIndex = "1000";
    } else {
      parentNode.style.zIndex = "";
    }
  }, [showMoreMenu, showColorPicker]);

  useEffect(() => {
    if (!showColorPicker && !showMoreMenu) return;
    const handleClickOutside = (e: PointerEvent | MouseEvent) => {
      const target = e.target as Node;
      if (colorPickerRef.current && !colorPickerRef.current.contains(target)) {
        setShowColorPicker(false);
      }
      if (moreMenuRef.current && !moreMenuRef.current.contains(target)) {
        setShowMoreMenu(false);
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setShowColorPicker(false);
        setShowMoreMenu(false);
      }
    };

    window.addEventListener("pointerdown", handleClickOutside, { capture: true });
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("pointerdown", handleClickOutside, { capture: true });
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [showColorPicker, showMoreMenu]);

  const folderName = data.workingDir ? data.workingDir.split("/").filter(Boolean).pop() : null;

  return (
    <div
      ref={containerRef}
      className={cn(
        "group/frame relative h-full w-full rounded-[14px] border-2 border-dashed",
        "transition-colors duration-150 pointer-events-none",
        theme.border,
        theme.bg,
        selected && cn("border-solid", theme.borderActive),
        // A block is hovering over this frame and will join it on release.
        isDropTarget && cn("border-solid", theme.borderActive, theme.bgHover),
      )}
    >
      <div className="absolute inset-0 rounded-[12px]" />

      {/* Header tab. Sits above the frame as an unconstrained floating pill that never wraps or breaks. */}
      <div
        className={cn(
          "absolute -top-[38px] left-0 flex h-[34px] w-max min-w-[180px] items-center gap-1.5",
          "rounded-t-[10px] border border-b-0 px-2 shadow-sm whitespace-nowrap",
          "pointer-events-auto backdrop-blur-md transition-colors",
          theme.headerBg,
          theme.headerBorder,
          selected && theme.borderActive,
        )}
      >
        {/* Dedicated drag handle */}
        <div
          className="flex h-full items-center justify-center cursor-grab active:cursor-grabbing text-fg-subtle/50 hover:text-fg px-1 transition-colors -space-x-[8px]"
          title="Drag frame"
        >
          <GripVertical size={16} strokeWidth={2.5} />
          <GripVertical size={16} strokeWidth={2.5} />
        </div>

        {/* Frame Label / Rename */}
        <div className="nodrag flex items-center gap-1.5 h-full">
          {editingLabel ? (
            <input
              ref={labelRef}
              className="min-w-[6ch] max-w-[140px] bg-transparent text-[12.5px] font-semibold text-fg outline-none border-b border-accent pb-0.5"
              defaultValue={data.label}
              autoFocus
              size={Math.max(data.label.length, 6)}
              onFocus={beginEdit}
              onBlur={(e) => {
                updateFrameData(id, { label: e.currentTarget.value.trim() || "Frame" });
                setEditingLabel(false);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === "Escape") e.currentTarget.blur();
                e.stopPropagation();
              }}
            />
          ) : (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setEditingLabel(true);
              }}
              title="Click to rename frame"
              className={cn(
                "flex shrink-0 items-center gap-1 rounded-[6px] px-1.5 py-0.5 text-[12.5px] font-semibold transition hover:bg-hover/80 max-w-[140px]",
                theme.text,
              )}
            >
              <span className="truncate">{data.label || "Frame"}</span>
              <Pencil
                size={10}
                strokeWidth={2}
                className="shrink-0 text-fg-subtle opacity-0 transition group-hover/frame:opacity-100"
              />
            </button>
          )}

          {/* Working Directory Pill (shown only when a folder is assigned) */}
          {folderName && (
            <div
              className={cn(
                "flex items-center gap-1 rounded-[5px] border px-1.5 py-0.5 text-[11px] font-medium transition max-w-[110px]",
                theme.badge,
              )}
              title={data.workingDir ?? undefined}
            >
              <Folder size={11} className="shrink-0 opacity-80" />
              <span className="truncate">{folderName}</span>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  clearFrameDirectory(id);
                }}
                title="Clear folder"
                className="ml-0.5 rounded hover:bg-hover hover:text-fg text-fg-subtle shrink-0"
              >
                <X size={9} strokeWidth={2.5} />
              </button>
            </div>
          )}

          {/* Block Count */}
          <span className="shrink-0 text-[11px] font-medium tabular-nums text-fg-subtle px-0.5">
            {memberCount}
          </span>
        </div>

        {/* Right Section: Color + Run + More Options */}
        <div className="nodrag flex items-center gap-1.5 ml-auto">
          {/* Color Palette Popover */}
          <div className="relative" ref={colorPickerRef}>
            <button
              type="button"
              title="Change frame color theme"
              onClick={(e) => {
                e.stopPropagation();
                setShowColorPicker((v) => !v);
                setShowMoreMenu(false);
              }}
              className={cn(
                "flex size-[26px] items-center justify-center rounded-[6px] transition",
                "text-fg-subtle hover:bg-hover hover:text-fg",
                showColorPicker && "bg-hover text-fg ring-1 ring-accent/40",
              )}
            >
              <span
                className="size-3 rounded-full border border-black/40 shadow-xs transition"
                style={{ backgroundColor: theme.dot }}
              />
            </button>

            {showColorPicker && (
              <div className="absolute right-0 top-[32px] z-50 flex items-center gap-1.5 rounded-lg border border-line-strong bg-elevated/95 p-1.5 shadow-xl backdrop-blur-md">
                {COLOR_KEYS.map((key) => {
                  const col = FRAME_THEMES[key];
                  const active = colorKey === key;
                  return (
                    <button
                      key={key}
                      type="button"
                      title={col.name}
                      onClick={(e) => {
                        e.stopPropagation();
                        updateFrameData(id, { color: key });
                        setShowColorPicker(false);
                      }}
                      className={cn(
                        "size-[20px] rounded-full transition transform hover:scale-125",
                        active && "ring-2 ring-white ring-offset-2 ring-offset-base scale-110",
                      )}
                      style={{ backgroundColor: col.dot }}
                    />
                  );
                })}
              </div>
            )}
          </div>

          {/* Run Button */}
          <button
            type="button"
            disabled={runActive || memberCount === 0}
            title={
              memberCount === 0
                ? "Drag blocks into this frame to run it"
                : `Run the ${memberCount} block${memberCount === 1 ? "" : "s"} in this frame`
            }
            onClick={(e) => {
              e.stopPropagation();
              void runFrame(id);
            }}
            className={cn(
              "flex shrink-0 items-center gap-1.5 rounded-[6px] px-2.5 h-[26px]",
              "text-[11.5px] font-semibold transition shadow-xs",
              theme.accent,
              "disabled:pointer-events-none disabled:opacity-35",
            )}
          >
            <Play size={10} fill="currentColor" strokeWidth={0} />
            <span>Run</span>
          </button>

          {/* More Actions Menu (...) */}
          <div className="relative" ref={moreMenuRef}>
            <button
              type="button"
              title="Frame options"
              onClick={(e) => {
                e.stopPropagation();
                setShowMoreMenu((v) => !v);
                setShowColorPicker(false);
              }}
              className={cn(
                "flex size-[26px] items-center justify-center rounded-[6px] transition",
                "text-fg-subtle hover:bg-hover hover:text-fg",
                showMoreMenu && "bg-hover text-fg",
              )}
            >
              <MoreHorizontal size={14} />
            </button>

            {showMoreMenu && (
              <div className="absolute right-0 top-[32px] z-50 flex flex-col w-[185px] rounded-lg border border-line-strong bg-elevated/95 p-1 shadow-xl backdrop-blur-md animate-in-soft">
                <button
                  type="button"
                  disabled={runActive || memberCount === 0}
                  onClick={(e) => {
                    e.stopPropagation();
                    setShowMoreMenu(false);
                    void runFrame(id, "live");
                  }}
                  className="flex items-center gap-2 rounded-[5px] px-2 py-1.5 text-[11.5px] font-medium text-fg hover:bg-hover transition text-left disabled:opacity-40"
                >
                  <Zap size={13} className="shrink-0 text-emerald-400" />
                  <span>Run Frame (Live)</span>
                </button>

                <button
                  type="button"
                  disabled={runActive || memberCount === 0}
                  onClick={(e) => {
                    e.stopPropagation();
                    setShowMoreMenu(false);
                    void runFrame(id, "sandbox");
                  }}
                  className="flex items-center gap-2 rounded-[5px] px-2 py-1.5 text-[11.5px] font-medium text-amber-300 hover:bg-amber-500/20 transition text-left disabled:opacity-40"
                >
                  <FlaskConical size={13} className="shrink-0 text-amber-400" />
                  <span>Run in Sandbox 🧪</span>
                </button>

                <button
                  type="button"
                  disabled={runActive || memberCount === 0}
                  onClick={(e) => {
                    e.stopPropagation();
                    setShowMoreMenu(false);
                    void runFrame(id, "dry_run");
                  }}
                  className="flex items-center gap-2 rounded-[5px] px-2 py-1.5 text-[11.5px] font-medium text-sky-300 hover:bg-sky-500/20 transition text-left disabled:opacity-40"
                >
                  <FileSearch size={13} className="shrink-0 text-sky-400" />
                  <span>Dry Run (Simulate) 📋</span>
                </button>

                <div className="my-1 h-px bg-line/60" />

                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    setShowMoreMenu(false);
                    void autoLayoutFrame(id);
                  }}
                  className="flex items-center gap-2 rounded-[5px] px-2 py-1.5 text-[11.5px] font-medium text-fg-muted hover:bg-hover hover:text-fg transition text-left"
                >
                  <LayoutDashboard size={13} className="shrink-0 text-fg-subtle" />
                  <span>Auto-align blocks</span>
                </button>

                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    setShowMoreMenu(false);
                    useRuntimeStore.getState().clearAll();
                  }}
                  className="flex items-center gap-2 rounded-[5px] px-2 py-1.5 text-[11.5px] font-medium text-fg-muted hover:bg-hover hover:text-fg transition text-left"
                >
                  <RotateCcw size={13} className="shrink-0 text-fg-subtle" />
                  <span>Reset run state</span>
                </button>

                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    setShowMoreMenu(false);
                    void exportFrame(id);
                  }}
                  className="flex items-center gap-2 rounded-[5px] px-2 py-1.5 text-[11.5px] font-medium text-fg-muted hover:bg-hover hover:text-fg transition text-left"
                >
                  <Download size={13} className="shrink-0 text-fg-subtle" />
                  <span>Export to JSON</span>
                </button>

                <div className="my-1 h-px bg-line/60" />

                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    setShowMoreMenu(false);
                    void chooseFrameDirectory(id);
                  }}
                  className="flex items-center gap-2 rounded-[5px] px-2 py-1.5 text-[11.5px] font-medium text-fg-muted hover:bg-hover hover:text-fg transition text-left"
                >
                  <FolderPlus size={13} className="shrink-0 text-fg-subtle" />
                  <span>{data.workingDir ? "Change folder…" : "Set folder…"}</span>
                </button>

                {data.workingDir && (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      setShowMoreMenu(false);
                      clearFrameDirectory(id);
                    }}
                    className="flex items-center gap-2 rounded-[5px] px-2 py-1.5 text-[11.5px] font-medium text-fg-muted hover:bg-hover hover:text-fg transition text-left"
                  >
                    <X size={13} className="shrink-0 text-fg-subtle" />
                    <span>Clear frame folder</span>
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {memberCount === 0 && (
        <div className="absolute inset-0 flex items-center justify-center">
          <p className="text-[12px] font-medium text-fg-subtle">Drag blocks in, or double-click to add one</p>
        </div>
      )}

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

export const FrameNode = memo(FrameNodeImpl);


