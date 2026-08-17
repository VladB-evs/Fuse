import { memo, useMemo, useState } from "react";
import { type NodeProps } from "@xyflow/react";
import { Clock, Maximize2, Minus, Plus, RefreshCw, RotateCcw, Terminal } from "lucide-react";
import { useWorkflowStore } from "@/store/workflowStore";
import { useUIStore } from "@/store/uiStore";
import { NodeShell, Note, fieldKeys } from "./NodeShell";
import { highlightCode } from "@/lib/syntaxHighlight";
import { cn } from "@/lib/utils";
import type { WaitNodeType } from "@/types/workflow";

type TimeUnit = "seconds" | "minutes" | "hours";

const UNIT_MULTIPLIERS: Record<TimeUnit, number> = {
  seconds: 1,
  minutes: 60,
  hours: 3600,
};

const INCREMENT_CHIPS: Record<TimeUnit, Array<{ label: string; amount: number }>> = {
  seconds: [
    { label: "+1s", amount: 1 },
    { label: "+5s", amount: 5 },
    { label: "+10s", amount: 10 },
    { label: "+30s", amount: 30 },
  ],
  minutes: [
    { label: "+1m", amount: 1 },
    { label: "+5m", amount: 5 },
    { label: "+10m", amount: 10 },
    { label: "+30m", amount: 30 },
  ],
  hours: [
    { label: "+1h", amount: 1 },
    { label: "+2h", amount: 2 },
    { label: "+6h", amount: 6 },
    { label: "+12h", amount: 12 },
  ],
};

const POLLING_PRESETS = [
  { label: "+ Health", cmd: "curl -fsS http://localhost:3000/health" },
  { label: "+ Port", cmd: "nc -z localhost 8080" },
  { label: "+ File", cmd: 'test -f "dist/index.js"' },
  { label: "+ Docker", cmd: "docker inspect -f '{{.State.Running}}' my-app" },
];

/**
 * A pause or polling condition step.
 *
 * Can execute a pure timed delay (e.g. 5 seconds), or poll a health check / readiness
 * command repeatedly until it returns exit code 0 (or reaches timeout).
 */
function WaitNodeImpl({ id, data, selected }: NodeProps<WaitNodeType>) {
  const updateNodeData = useWorkflowStore((s) => s.updateNodeData);
  const beginEdit = useWorkflowStore((s) => s.beginEdit);
  const openWaitEditor = useUIStore((s) => s.openWaitEditor);

  const rawSeconds = data.seconds ?? 2;
  const rawInterval = data.intervalSeconds ?? 1;
  const rawTimeout = data.timeoutSeconds ?? 60;
  const until = data.until ?? "";

  // Unit state for display
  const [delayUnit, setDelayUnit] = useState<TimeUnit>(() => {
    if (rawSeconds >= 3600 && rawSeconds % 3600 === 0) return "hours";
    if (rawSeconds >= 60 && rawSeconds % 60 === 0) return "minutes";
    return "seconds";
  });

  const [timeoutUnit, setTimeoutUnit] = useState<"seconds" | "minutes">(() => {
    if (rawTimeout >= 60 && rawTimeout % 60 === 0) return "minutes";
    return "seconds";
  });

  // Calculate display value based on selected unit
  const displayDelayValue = useMemo(() => {
    const mult = UNIT_MULTIPLIERS[delayUnit];
    const val = rawSeconds / mult;
    return Number.isInteger(val) ? String(val) : String(Number(val.toFixed(2)));
  }, [rawSeconds, delayUnit]);

  const displayTimeoutValue = useMemo(() => {
    const mult = timeoutUnit === "minutes" ? 60 : 1;
    const val = rawTimeout / mult;
    return Number.isInteger(val) ? String(val) : String(Number(val.toFixed(2)));
  }, [rawTimeout, timeoutUnit]);

  const handleDelayNumberChange = (strVal: string) => {
    const parsed = Number.parseFloat(strVal);
    const num = Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
    const mult = UNIT_MULTIPLIERS[delayUnit];
    beginEdit();
    updateNodeData(id, { seconds: num * mult });
  };

  const handleDelayUnitChange = (newUnit: TimeUnit) => {
    setDelayUnit(newUnit);
  };

  const incrementDelay = (amountInUnit: number) => {
    const mult = UNIT_MULTIPLIERS[delayUnit];
    const currentVal = rawSeconds / mult;
    const nextVal = Math.max(0, Math.round((currentVal + amountInUnit) * 100) / 100);
    beginEdit();
    updateNodeData(id, { seconds: nextVal * mult });
  };

  const resetDelay = () => {
    beginEdit();
    updateNodeData(id, { seconds: 0 });
  };

  const handleTimeoutNumberChange = (strVal: string) => {
    const parsed = Number.parseFloat(strVal);
    const num = Number.isFinite(parsed) && parsed >= 0 ? parsed : 1;
    const mult = timeoutUnit === "minutes" ? 60 : 1;
    beginEdit();
    updateNodeData(id, { timeoutSeconds: num * mult });
  };

  const handleTimeoutUnitChange = (newUnit: "seconds" | "minutes") => {
    setTimeoutUnit(newUnit);
    const parsed = Number.parseFloat(displayTimeoutValue);
    const num = Number.isFinite(parsed) && parsed >= 0 ? parsed : 1;
    const mult = newUnit === "minutes" ? 60 : 1;
    beginEdit();
    updateNodeData(id, { timeoutSeconds: num * mult });
  };

  const handleIntervalChange = (strVal: string) => {
    const parsed = Number.parseFloat(strVal);
    const num = Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
    beginEdit();
    updateNodeData(id, { intervalSeconds: num });
  };

  const setPresetPolling = (cmd: string) => {
    beginEdit();
    updateNodeData(id, { until: cmd });
  };

  const isPolling = until.trim().length > 0;
  const highlightedUntil = useMemo(() => highlightCode(until, "bash"), [until]);
  const estimatedAttempts = isPolling ? Math.max(1, Math.floor(rawTimeout / Math.max(0.1, rawInterval))) : 0;
  const chips = INCREMENT_CHIPS[delayUnit];

  return (
    <NodeShell
      id={id}
      kind="wait"
      label={data.label}
      frameId={data.frameId}
      selected={!!selected}
      workingDir={data.workingDir}
      width={340}
      onRename={(label) => updateNodeData(id, { label })}
    >
      {/* 1. Fixed Duration Delay Input with Unit Selector & Increment Chips */}
      <div>
        <div className="mb-1.5 flex items-center justify-between">
          <label className="flex items-center gap-1 text-[10.5px] font-medium text-fg-subtle">
            <Clock size={11} className="text-accent" />
            <span>Delay duration</span>
          </label>

          {/* Unit Selector Pills */}
          <div className="nodrag flex shrink-0 items-center gap-0.5 rounded-[5px] border border-line bg-elevated/70 p-0.5">
            {(["seconds", "minutes", "hours"] as TimeUnit[]).map((u) => {
              const active = delayUnit === u;
              const shortLabel = u === "seconds" ? "Sec" : u === "minutes" ? "Min" : "Hour";
              return (
                <button
                  key={u}
                  type="button"
                  onClick={() => handleDelayUnitChange(u)}
                  className={cn(
                    "rounded-[3px] px-1.5 py-0.5 font-mono text-[9.5px] font-bold transition cursor-pointer",
                    active
                      ? "bg-accent text-white shadow-xs"
                      : "text-fg-subtle hover:bg-hover hover:text-fg",
                  )}
                >
                  {shortLabel}
                </button>
              );
            })}
          </div>
        </div>

        {/* Stepper + Number Input + Quick Increment Chips */}
        <div className="space-y-1.5">
          <div className="nodrag flex items-center gap-1 rounded-[6px] border border-line bg-elevated/50 p-1">
            <button
              type="button"
              onClick={() => incrementDelay(-1)}
              className="flex size-[26px] shrink-0 items-center justify-center rounded-[4px] border border-line bg-base/80 text-fg-subtle hover:bg-hover hover:text-fg transition cursor-pointer"
              title={`Subtract 1 ${delayUnit.slice(0, -1)}`}
            >
              <Minus size={11} />
            </button>

            <input
              type="number"
              min="0"
              step="any"
              value={displayDelayValue}
              spellCheck={false}
              onFocus={beginEdit}
              onChange={(e) => handleDelayNumberChange(e.currentTarget.value)}
              onKeyDown={(e) => fieldKeys(e)}
              className="nodrag min-w-0 flex-1 rounded-[4px] border border-line/80 bg-base/90 px-2 py-1 font-mono text-[12.5px] font-bold text-fg text-center outline-none transition focus:border-accent"
            />

            <button
              type="button"
              onClick={() => incrementDelay(1)}
              className="flex size-[26px] shrink-0 items-center justify-center rounded-[4px] border border-line bg-base/80 text-fg-subtle hover:bg-hover hover:text-fg transition cursor-pointer"
              title={`Add 1 ${delayUnit.slice(0, -1)}`}
            >
              <Plus size={11} />
            </button>

            <button
              type="button"
              onClick={resetDelay}
              className="flex size-[26px] shrink-0 items-center justify-center rounded-[4px] border border-line bg-base/80 text-fg-subtle hover:bg-hover hover:text-fg transition cursor-pointer"
              title="Reset to 0"
            >
              <RotateCcw size={10} />
            </button>
          </div>

          {/* Increment Chips based on selected unit */}
          <div className="nodrag flex items-center justify-between gap-1">
            <span className="text-[9.5px] font-medium text-fg-subtle/80">Add:</span>
            <div className="flex items-center gap-1 flex-1 justify-end">
              {chips.map((c) => (
                <button
                  key={c.label}
                  type="button"
                  onClick={() => incrementDelay(c.amount)}
                  className="rounded-[4px] border border-line/70 bg-elevated/60 px-2 py-0.5 font-mono text-[10px] font-semibold text-fg-subtle transition hover:border-line-strong hover:bg-hover hover:text-accent cursor-pointer"
                  title={`Add ${c.amount} ${delayUnit}`}
                >
                  {c.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* 2. Wait Until Shell Command (Polling condition) */}
      <div className="border-t border-line/60 pt-2">
        <div className="mb-1.5 flex items-center justify-between">
          <label className="flex items-center gap-1 text-[10.5px] font-medium text-fg-subtle">
            <Terminal size={11} className="text-amber-400" />
            <span>Poll command (optional)</span>
          </label>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              openWaitEditor(id);
            }}
            className="nodrag flex items-center gap-1 rounded-[4px] border border-line/80 bg-elevated/70 px-1.5 py-0.5 text-[9.5px] font-medium text-accent hover:bg-hover hover:text-fg transition cursor-pointer"
            title="Open full command editor"
          >
            <Maximize2 size={9} />
            <span>Expand</span>
          </button>
        </div>

        {/* Quick Polling Preset Chips */}
        <div className="nodrag mb-1.5 flex flex-wrap gap-1">
          {POLLING_PRESETS.map((p) => (
            <button
              key={p.label}
              type="button"
              onClick={() => setPresetPolling(p.cmd)}
              className="rounded-[3px] border border-line/60 bg-elevated/50 px-1.5 py-0.5 font-mono text-[9px] text-fg-subtle transition hover:border-line-strong hover:bg-hover hover:text-fg cursor-pointer"
            >
              {p.label}
            </button>
          ))}
        </div>

        {/* Read-Only Syntax-Highlighted Command Box */}
        <div
          onClick={(e) => {
            e.stopPropagation();
            openWaitEditor(id);
          }}
          className="group/code relative rounded-[5px] border border-line bg-elevated/50 p-2 cursor-pointer transition hover:bg-elevated/80 select-none min-h-[46px] overflow-hidden"
          title="Click to open full command editor"
        >
          {until.trim() ? (
            <pre
              aria-hidden="true"
              className="m-0 whitespace-pre font-mono text-[11px] leading-[16px] text-fg overflow-x-auto"
            >
              <code
                className="language-bash"
                dangerouslySetInnerHTML={{ __html: highlightedUntil }}
              />
            </pre>
          ) : (
            <div className="flex h-[30px] items-center justify-center text-[10px] font-mono text-fg-subtle/60 italic">
              No polling command — click to add readiness test…
            </div>
          )}
        </div>
      </div>

      {/* 3. Reworked Polling Interval & Timeout Configuration */}
      {isPolling && (
        <div className="space-y-1.5 rounded-[6px] border border-amber-500/30 bg-amber-500/5 p-2 transition animate-in fade-in duration-150">
          <div className="flex items-center justify-between text-[10px] font-bold text-amber-400">
            <span className="flex items-center gap-1">
              <RefreshCw size={11} className="text-amber-400 animate-spin-slow" />
              <span>POLLING RETRY RULES</span>
            </span>
            <span className="font-mono text-[9px] font-normal text-amber-300/80">
              ~{estimatedAttempts} attempts max
            </span>
          </div>

          <div className="grid grid-cols-2 gap-1.5">
            {/* Check Every (Interval) */}
            <div className="flex flex-col gap-0.5">
              <span className="text-[9.5px] font-medium text-fg-subtle">Check every</span>
              <div className="nodrag flex items-center gap-1 rounded-[4px] border border-line bg-base/80 px-1.5 py-0.5">
                <input
                  type="number"
                  min="0.1"
                  step="any"
                  value={rawInterval}
                  onFocus={beginEdit}
                  onChange={(e) => handleIntervalChange(e.currentTarget.value)}
                  onKeyDown={(e) => fieldKeys(e)}
                  className="nodrag min-w-0 flex-1 bg-transparent font-mono text-[11px] font-semibold text-fg outline-none"
                />
                <span className="font-mono text-[9.5px] text-fg-subtle font-medium">sec</span>
              </div>
            </div>

            {/* Give Up After (Timeout) */}
            <div className="flex flex-col gap-0.5">
              <span className="text-[9.5px] font-medium text-fg-subtle">Give up after</span>
              <div className="nodrag flex items-center gap-1 rounded-[4px] border border-line bg-base/80 px-1.5 py-0.5">
                <input
                  type="number"
                  min="1"
                  step="any"
                  value={displayTimeoutValue}
                  onFocus={beginEdit}
                  onChange={(e) => handleTimeoutNumberChange(e.currentTarget.value)}
                  onKeyDown={(e) => fieldKeys(e)}
                  className="nodrag min-w-0 flex-1 bg-transparent font-mono text-[11px] font-semibold text-fg outline-none"
                />
                {/* Unit Switcher */}
                <button
                  type="button"
                  onClick={() => handleTimeoutUnitChange(timeoutUnit === "seconds" ? "minutes" : "seconds")}
                  className="rounded px-1 py-0.2 font-mono text-[9px] font-bold text-accent hover:bg-hover transition cursor-pointer"
                  title="Toggle seconds / minutes"
                >
                  {timeoutUnit === "seconds" ? "sec" : "min"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 4. Dynamic Summary Note */}
      <Note>
        {isPolling
          ? `Delays ${rawSeconds}s, then polls every ${rawInterval}s (timeout: ${rawTimeout}s).`
          : `Pauses execution for ${rawSeconds}s before continuing.`}
      </Note>
    </NodeShell>
  );
}

export const WaitNode = memo(WaitNodeImpl);
