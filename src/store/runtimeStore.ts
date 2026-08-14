/**
 * Live execution state.
 *
 * Kept separate from the document store on purpose: running a workflow must
 * never mark it dirty, and clearing a run must never touch the graph.
 *
 * Engine events arrive pre-batched (one batch per frame) and are folded into a
 * single `set` call so noisy commands don't cause a render per line.
 */

import { create } from "zustand";
import type {
  EngineEvent,
  NodeRunMeta,
  NodeRunState,
  OutputLine,
  PromptRequest,
  RunStatus,
} from "@/types/workflow";

/** Per-node ring buffer cap. Keeps memory bounded on chatty commands. */
const OUTPUT_LIMIT = 5000;

const emptyMeta = (): NodeRunMeta => ({
  exitCode: null,
  durationMs: null,
  startedAt: null,
  finishedAt: null,
  workingDir: null,
  reason: null,
});

export type RuntimeState = {
  runId: string | null;
  running: boolean;
  startedAt: number | null;
  order: string[];
  statuses: Record<string, NodeRunState>;
  output: Record<string, OutputLine[]>;
  meta: Record<string, NodeRunMeta>;
  lastRun: { status: RunStatus; durationMs: number; at: number } | null;
  error: string | null;
  /**
   * The question the run is currently parked on, if any. Only ever one: the
   * engine is a single sequential walk, so a waiting step waits alone.
   */
  prompt: PromptRequest | null;

  applyEvents: (events: EngineEvent[]) => void;
  clearOutput: (nodeId: string) => void;
  clearAll: () => void;
  setError: (message: string | null) => void;
  /** Clear the pending question once it has been answered. */
  clearPrompt: () => void;
  /** Local-only reset used when a run fails to start. */
  abortLocalRun: () => void;
};

export const useRuntimeStore = create<RuntimeState>()((set) => ({
  runId: null,
  running: false,
  startedAt: null,
  order: [],
  statuses: {},
  output: {},
  meta: {},
  lastRun: null,
  error: null,
  prompt: null,

  applyEvents: (events) =>
    set((state) => {
      let { runId, running, startedAt, order, lastRun, error, prompt } = state;
      const statuses = { ...state.statuses };
      const meta = { ...state.meta };
      const output = { ...state.output };

      // Only clone the arrays we actually append to, so untouched nodes keep
      // their reference and skip re-rendering.
      const touched = new Set<string>();
      const appendLine = (nodeId: string, line: OutputLine) => {
        if (!touched.has(nodeId)) {
          output[nodeId] = output[nodeId] ? [...output[nodeId]] : [];
          touched.add(nodeId);
        }
        const buffer = output[nodeId]!;
        buffer.push(line);
        if (buffer.length > OUTPUT_LIMIT) {
          buffer.splice(0, buffer.length - OUTPUT_LIMIT);
        }
      };

      for (const event of events) {
        switch (event.event) {
          case "runStarted": {
            runId = event.runId;
            running = true;
            startedAt = event.at;
            order = event.order;
            error = null;
            lastRun = null;
            prompt = null;
            // A new run starts from a clean slate for the blocks it will touch.
            for (const id of event.order) {
              statuses[id] = "pending";
              meta[id] = emptyMeta();
              output[id] = [];
              touched.add(id);
            }
            break;
          }

          case "nodeStarted": {
            statuses[event.nodeId] = "running";
            meta[event.nodeId] = {
              ...(meta[event.nodeId] ?? emptyMeta()),
              startedAt: event.at,
              finishedAt: null,
              workingDir: event.workingDir,
              reason: null,
            };
            break;
          }

          case "nodeOutput": {
            appendLine(event.nodeId, {
              stream: event.stream,
              text: event.line,
              at: event.at,
            });
            break;
          }

          case "nodeWaiting": {
            statuses[event.nodeId] = "waiting";
            prompt = event.prompt;
            break;
          }

          case "nodeFinished": {
            statuses[event.nodeId] = event.status;
            // The step moved on, so whatever it was asking is settled — even
            // if the answer came from somewhere else (a stop, a timeout).
            if (prompt?.nodeId === event.nodeId) prompt = null;
            meta[event.nodeId] = {
              ...(meta[event.nodeId] ?? emptyMeta()),
              exitCode: event.exitCode,
              durationMs: event.durationMs,
              finishedAt: event.at,
            };
            break;
          }

          case "nodeSkipped": {
            statuses[event.nodeId] = "skipped";
            meta[event.nodeId] = {
              ...(meta[event.nodeId] ?? emptyMeta()),
              reason: event.reason,
              finishedAt: event.at,
            };
            break;
          }

          case "runFinished": {
            running = false;
            prompt = null;
            lastRun = { status: event.status, durationMs: event.durationMs, at: event.at };
            break;
          }
        }
      }

      return {
        runId,
        running,
        startedAt,
        order,
        statuses,
        meta,
        output,
        lastRun,
        error,
        prompt,
      };
    }),

  clearOutput: (nodeId) =>
    set((state) => ({
      output: { ...state.output, [nodeId]: [] },
      meta: { ...state.meta, [nodeId]: emptyMeta() },
      statuses: { ...state.statuses, [nodeId]: "idle" },
    })),

  clearAll: () =>
    set({
      statuses: {},
      output: {},
      meta: {},
      lastRun: null,
      error: null,
      order: [],
      startedAt: null,
      prompt: null,
    }),

  setError: (message) => set({ error: message }),

  clearPrompt: () => set({ prompt: null }),

  abortLocalRun: () =>
    set({ running: false, runId: null, startedAt: null, prompt: null }),
}));

/** Convenience selector: has this node produced any output yet? */
export function selectHasOutput(state: RuntimeState, nodeId: string): boolean {
  return (state.output[nodeId]?.length ?? 0) > 0;
}
