import type { NodeRunState, RunStatus } from "@/types/workflow";

export type Tone = "muted" | "accent" | "success" | "danger" | "warn";

export const STATUS_LABEL: Record<NodeRunState, string> = {
  idle: "Ready",
  pending: "Queued",
  running: "Running",
  waiting: "Waiting for you",
  success: "Success",
  failed: "Failed",
  skipped: "Skipped",
  cancelled: "Stopped",
};

export const STATUS_TONE: Record<NodeRunState, Tone> = {
  idle: "muted",
  pending: "muted",
  running: "accent",
  waiting: "warn",
  success: "success",
  failed: "danger",
  skipped: "muted",
  cancelled: "warn",
};

export const TONE_TEXT: Record<Tone, string> = {
  muted: "text-fg-subtle",
  accent: "text-accent",
  success: "text-success",
  danger: "text-danger",
  warn: "text-warn",
};

export const TONE_BG: Record<Tone, string> = {
  muted: "bg-fg-subtle",
  accent: "bg-accent",
  success: "bg-success",
  danger: "bg-danger",
  warn: "bg-warn",
};

export const RUN_STATUS_LABEL: Record<RunStatus, string> = {
  success: "Workflow finished",
  failed: "Workflow failed",
  cancelled: "Workflow stopped",
};

export const RUN_STATUS_TONE: Record<RunStatus, Tone> = {
  success: "success",
  failed: "danger",
  cancelled: "warn",
};
