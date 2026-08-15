/**
 * The only module that talks to Rust.
 *
 * Everything above this file works with plain typed values and has no idea
 * Tauri exists, which keeps the UI testable and the boundary obvious.
 */

import { invoke } from "@tauri-apps/api/core";
import type {
  PromptReply,
  RepositoryActivity,
  RunMode,
  WorkflowDocument,
  WorkflowSummary,
} from "@/types/workflow";

export interface AppSettings {
  customWorkflowDir: string | null;
  workflowDir: string;
}

export function getSettings(): Promise<AppSettings> {
  return invoke("get_settings");
}

export function setWorkflowDirectory(path: string | null): Promise<void> {
  return invoke("set_workflow_directory", { path });
}

export function openDirectory(path: string): Promise<void> {
  return invoke("open_directory", { path });
}

export function listWorkflows(): Promise<WorkflowSummary[]> {
  return invoke("list_workflows");
}

export function loadWorkflow(id: string): Promise<WorkflowDocument> {
  return invoke("load_workflow", { id });
}

export function saveWorkflow(workflow: WorkflowDocument): Promise<WorkflowDocument> {
  return invoke("save_workflow", { workflow });
}

export function deleteWorkflow(id: string): Promise<void> {
  return invoke("delete_workflow", { id });
}

/** Starts a run and resolves with its id; progress arrives as engine events. */
export function runWorkflow(
  workflow: WorkflowDocument,
  runMode?: RunMode,
): Promise<string> {
  return invoke("run_workflow", { workflow, runMode: runMode ?? "live" });
}

export function runNode(
  workflow: WorkflowDocument,
  nodeId: string,
  runMode?: RunMode,
): Promise<string> {
  return invoke("run_node", { workflow, nodeId, runMode: runMode ?? "live" });
}

export function applySandboxChanges(runId: string): Promise<void> {
  return invoke("apply_sandbox_changes", { runId });
}

export function discardSandbox(runId: string): Promise<void> {
  return invoke("discard_sandbox", { runId });
}

export function stopRun(): Promise<void> {
  return invoke("stop_run");
}

/** Answer the question a paused run is waiting on, releasing the engine. */
export function resolvePrompt(
  runId: string,
  nodeId: string,
  reply: PromptReply,
): Promise<void> {
  return invoke("resolve_prompt", { runId, nodeId, reply });
}

export function isRunning(): Promise<boolean> {
  return invoke("is_running");
}

export function homeDirectory(): Promise<string> {
  return invoke("home_directory");
}

/** Native folder picker. Resolves `null` when the user cancels. */
export function pickDirectory(): Promise<string | null> {
  return invoke("pick_directory");
}

/** A local Git activity summary for the workflow's attached folder. */
export function repositoryActivity(directory: string): Promise<RepositoryActivity> {
  return invoke("repository_activity", { directory });
}
