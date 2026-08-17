/**
 * Application actions.
 *
 * The single place where UI intent turns into store mutations plus bridge
 * calls. Toolbar, command palette, keyboard shortcuts and nodes all funnel
 * through here, so behaviour can't drift between entry points.
 */

import * as api from "@/bridge/commands";
import { useRuntimeStore } from "@/store/runtimeStore";
import { useUIStore, type InputValues } from "@/store/uiStore";
import { isDefaultFrameName, useWorkflowStore } from "@/store/workflowStore";
import {
  isFrameNode,
  type FrameNodeType,
  type NodeKind,
  type BlockData,
  type PersistedNode,
  type PromptReply,
  type PromptRequest,
  type WorkflowDocument,
} from "@/types/workflow";
import { SOURCE_PORT, TARGET_PORT } from "@/canvas/ports";
import { catalogEntry } from "@/lib/catalog";
import { fillPlaceholders, fillPlaceholdersRaw, placeholdersIn } from "@/lib/placeholders";
import { save, open } from "@tauri-apps/plugin-dialog";
import { writeTextFile, readTextFile } from "@tauri-apps/plugin-fs";
import { v4 as uuidv4 } from "uuid";
import { parseFuseJson, prepareImportedNodesAndEdges } from "@/lib/jsonImporter";


const LAST_OPENED_KEY = "fuse.lastWorkflowId";

function message(error: unknown): string {
  if (typeof error === "string") return error;
  if (error instanceof Error) return error.message;
  return String(error);
}

export function rememberLastOpened(id: string) {
  try {
    localStorage.setItem(LAST_OPENED_KEY, id);
  } catch {
    // Private-mode or storage-disabled: losing the pointer is not fatal.
  }
}

export function lastOpenedId(): string | null {
  try {
    return localStorage.getItem(LAST_OPENED_KEY);
  } catch {
    return null;
  }
}

// --- Persistence ----------------------------------------------------------

/** Explicit save (⌘S) — confirms in the toolbar. */
export async function saveCurrentWorkflow(): Promise<void> {
  const doc = useWorkflowStore.getState().toDocument();
  try {
    const saved = await api.saveWorkflow(doc);
    useWorkflowStore.getState().markSaved(saved);
    rememberLastOpened(saved.id);
    useUIStore.getState().notify(`Saved “${saved.name}”`);
  } catch (error) {
    useUIStore.getState().notify(message(error), "error");
  }
}

/** Background save driven by the autosave timer — stays silent. */
export async function autosaveWorkflow(): Promise<void> {
  const state = useWorkflowStore.getState();
  // Don't litter the workflow list with empty, never-touched documents.
  if (state.nodes.length === 0 && state.updatedAt === 0) return;

  try {
    const saved = await api.saveWorkflow(state.toDocument());
    useWorkflowStore.getState().markSaved(saved);
    rememberLastOpened(saved.id);
  } catch {
    // Autosave is best-effort; ⌘S surfaces real errors.
  }
}

export async function openWorkflowById(id: string): Promise<void> {
  try {
    const doc = await api.loadWorkflow(id);
    useWorkflowStore.getState().loadDocument(doc);
    useRuntimeStore.getState().clearAll();
    useUIStore.getState().inspect(null, { open: false });
    rememberLastOpened(doc.id);
  } catch (error) {
    useUIStore.getState().notify(message(error), "error");
  }
}

/** Rename a saved workflow without making the user open it first. */
export async function renameSavedWorkflow(id: string, name: string): Promise<void> {
  const nextName = name.trim() || "Untitled";
  try {
    // Preserve unsaved canvas changes when renaming the workflow already open.
    if (useWorkflowStore.getState().id === id) {
      useWorkflowStore.getState().setName(nextName);
      await saveCurrentWorkflow();
      return;
    }

    const workflow = await api.loadWorkflow(id);
    await api.saveWorkflow({ ...workflow, name: nextName });
    useUIStore.getState().notify(`Renamed to “${nextName}”`);
  } catch (error) {
    useUIStore.getState().notify(message(error), "error");
    throw error;
  }
}

export async function createNewWorkflow(saveImmediately: boolean = true): Promise<WorkflowDocument | null> {
  await autosaveWorkflow();
  try {
    useWorkflowStore.getState().resetWorkflow();
    
    if (saveImmediately) {
      const saved = await api.saveWorkflow(useWorkflowStore.getState().toDocument());
      useWorkflowStore.getState().markSaved(saved);
      useRuntimeStore.getState().clearAll();
      useUIStore.getState().inspect(null, { open: false });
      rememberLastOpened(saved.id);
      useUIStore.getState().notify("New workflow created");
      return saved;
    } else {
      useRuntimeStore.getState().clearAll();
      useUIStore.getState().inspect(null, { open: false });
      return null;
    }
  } catch (error) {
    useUIStore.getState().notify(message(error), "error");
    return null;
  }
}

// --- Editing --------------------------------------------------------------

export function addCommandBlock(position?: { x: number; y: number }): string {
  const pos = position ?? getCanvasSpawnPoint();
  const id = useWorkflowStore.getState().addBlockNode("command", { position: pos });
  useUIStore.getState().requestFocus(id);
  return id;
}

/** The nudge each kind gets when it lands, where there is one worth giving. */
const BLOCK_HINT: Partial<Record<NodeKind, string>> = {
  approval: "The run will pause here for your yes or no",
  choice: "Wire it to the paths it should pick between",
  input: "Name the value so later steps can use it",
  capture: "Name the value so later steps can use it",
  condition: "Wires leaving the bottom are yes, the right-hand one is no",
  wait: "Give it a command to poll, or just a delay",
  http: "Values from earlier steps work in the URL, headers and body",
  script: "Pick an interpreter and write the script",
};

/**
 * Add a block of any kind, optionally wiring it to where a dragged wire was
 * dropped. The single entry point behind the picker, the palette and the
 * keyboard.
 */
export function addNodeOfKind(
  kind: NodeKind,
  position?: { x: number; y: number },
  connectFrom?: { nodeId: string; handleId: string | null; backwards: boolean },
  prefill?: Partial<BlockData>,
): string {
  const workflow = useWorkflowStore.getState();

  const spawnPos = position ?? (connectFrom ? undefined : getCanvasSpawnPoint());

  if (kind === "frame") {
    const id = workflow.addFrameNode(spawnPos ? { position: spawnPos } : undefined);
    useUIStore.getState().notify("Frame added — set its folder to run it");
    return id;
  }

  // A wire dropped on empty canvas already said where the block goes, so it
  // must not also chain itself onto whatever happened to be selected.
  const sourceNode = connectFrom ? workflow.nodes.find(n => n.id === connectFrom.nodeId) : undefined;
  const sourceFrameId = sourceNode && "frameId" in sourceNode.data ? sourceNode.data.frameId : undefined;
  
  const id = workflow.addBlockNode(
    kind,
    spawnPos
      ? { position: spawnPos, frameId: sourceFrameId, prefill }
      : (sourceFrameId !== undefined ? { frameId: sourceFrameId, prefill } : { prefill })
  );

  if (connectFrom) {
    useWorkflowStore.getState().onConnect(
      connectFrom.backwards
        ? {
            source: id,
            target: connectFrom.nodeId,
            sourceHandle: SOURCE_PORT,
            targetHandle: connectFrom.handleId,
          }
        : {
            source: connectFrom.nodeId,
            target: id,
            sourceHandle: connectFrom.handleId,
            targetHandle: TARGET_PORT,
          },
    );
  }

  if (kind === "command") useUIStore.getState().requestFocus(id);

  const hint = BLOCK_HINT[kind];
  useUIStore.getState().notify(hint ? `${catalogEntry(kind).label} added — ${hint}` : "Block added");

  return id;
}

/** Open the block picker somewhere sensible: the pointer, or the canvas centre. */
export function openNodePicker(at?: { x: number; y: number }) {
  const mouse = getLastMouseScreen();
  const point = at ?? (mouse ?? { x: window.innerWidth / 2 - 160, y: window.innerHeight / 3 });
  useUIStore.getState().openPicker({ at: point, position: canvasSpawnPoint(point) });
}

/**
 * Screen point -> canvas point.
 *
 * Set by the canvas on mount; without it the picker still works, it just drops
 * blocks where the store would have put them anyway.
 */
let canvasPoint: (point: { x: number; y: number }) => { x: number; y: number } = (point) => point;
let canvasSpawnPoint: (screenPoint?: { x: number; y: number }) => { x: number; y: number } = () => ({ x: 240, y: 160 });
let lastMouseScreen: { x: number; y: number } | null = null;

export function recordMouseScreen(point: { x: number; y: number } | null) {
  lastMouseScreen = point;
}

export function getLastMouseScreen(): { x: number; y: number } | null {
  return lastMouseScreen;
}

export function setCanvasProjection(
  project: typeof canvasPoint,
  getSpawn: typeof canvasSpawnPoint = () => project({ x: window.innerWidth / 2, y: window.innerHeight / 2 }),
) {
  canvasPoint = project;
  canvasSpawnPoint = getSpawn;
}

export function getCanvasSpawnPoint(screenPoint?: { x: number; y: number }): { x: number; y: number } {
  return canvasSpawnPoint(screenPoint);
}

// --- Wires ----------------------------------------------------------------

/** Cut one wire. */
export function disconnectEdge(edgeId: string): void {
  useWorkflowStore.getState().disconnect(edgeId);
}

/** Cut every wire touching the current selection. */
export function disconnectSelection(): void {
  const selected = useWorkflowStore.getState().nodes.filter((n) => n.selected).map((n) => n.id);
  if (selected.length === 0) {
    useUIStore.getState().notify("Select a block first", "error");
    return;
  }

  const cut = useWorkflowStore.getState().disconnectNodes(selected);
  useUIStore
    .getState()
    .notify(cut === 0 ? "Nothing was connected" : `${cut} wire${cut === 1 ? "" : "s"} cut`);
}

export function addFrameBlock(position?: { x: number; y: number }): string {
  const pos = position ?? getCanvasSpawnPoint();
  return useWorkflowStore.getState().addFrameNode({ position: pos });
}

/** Take a block out of the frame it sits in. */
export function releaseBlockFromFrame(nodeId: string): void {
  useWorkflowStore.getState().releaseFromFrame(nodeId);
  useUIStore.getState().notify("Block taken out of its frame");
}

/**
 * Pick the folder every block inside this frame runs in.
 *
 * A frame still carrying its default name takes the folder's name — two
 * frames called "~/api" and "~/web" tell themselves apart, "Frame 1" and
 * "Frame 2" do not. Renaming by hand switches that off.
 */
export async function chooseFrameDirectory(frameId: string): Promise<void> {
  try {
    const picked = await api.pickDirectory();
    if (!picked) return;

    const frame = useWorkflowStore
      .getState()
      .nodes.find((n) => n.id === frameId && isFrameNode(n)) as FrameNodeType | undefined;

    const basename = picked.split("/").filter(Boolean).pop();
    const rename = frame && isDefaultFrameName(frame.data.label) && basename;

    useWorkflowStore.getState().beginEdit();
    useWorkflowStore.getState().updateFrameData(frameId, {
      workingDir: picked,
      ...(rename ? { label: basename } : {}),
    });
    useUIStore.getState().notify(rename ? `Frame set to “${basename}”` : "Frame folder set");
  } catch (error) {
    useUIStore.getState().notify(message(error), "error");
  }
}

/** Back to inheriting the workflow folder. */
export function clearFrameDirectory(frameId: string): void {
  useWorkflowStore.getState().beginEdit();
  useWorkflowStore.getState().updateFrameData(frameId, { workingDir: null });
}

/** Choose a one-off folder for a block, overriding its frame/workflow folder. */
export async function chooseNodeDirectory(nodeId: string): Promise<void> {
  try {
    const picked = await api.pickDirectory();
    if (!picked) return;
    useWorkflowStore.getState().beginEdit();
    useWorkflowStore.getState().updateNodeData(nodeId, { workingDir: picked });
    useUIStore.getState().notify("Block folder set");
  } catch (error) {
    useUIStore.getState().notify(message(error), "error");
  }
}

/** Return a block to the directory supplied by its frame or workflow. */
export function clearNodeDirectory(nodeId: string): void {
  useWorkflowStore.getState().beginEdit();
  useWorkflowStore.getState().updateNodeData(nodeId, { workingDir: null });
}

export async function chooseWorkingDirectory(): Promise<void> {
  try {
    const picked = await api.pickDirectory();
    if (!picked) return;
    useWorkflowStore.getState().setWorkingDir(picked);
    useUIStore.getState().notify("Project folder set");
  } catch (error) {
    useUIStore.getState().notify(message(error), "error");
  }
}

/** With no attached folder, commands deliberately start at the filesystem root. */
export function clearWorkingDirectory(): void {
  useWorkflowStore.getState().setWorkingDir(null);
  useUIStore.getState().notify("Workflow folder cleared — commands will run from /");
}

// --- Execution ------------------------------------------------------------

function isNodeEffectivelyDisabled(node: PersistedNode, doc: WorkflowDocument): boolean {
  if (node.data && "disabled" in node.data && node.data.disabled) return true;

  const nodeFid = node.data && "frameId" in node.data ? (node.data.frameId as string) : null;

  // Check incoming edges: a node is effectively disabled if all its incoming edges are disabled
  const inEdges = doc.edges.filter(
    (e) => e.target === node.id || (nodeFid && e.target === nodeFid),
  );
  if (inEdges.length > 0 && inEdges.every((e) => e.disabled)) {
    return true;
  }

  return false;
}

function isVariableProvidedUpstream(
  varName: string,
  targetNode: PersistedNode,
  doc: WorkflowDocument,
  runTargetIds?: string[],
): boolean {
  // Find all active candidate producer nodes for this variable
  const producers = doc.nodes.filter((n) => {
    if (isNodeEffectivelyDisabled(n, doc)) return false;
    if (n.id === targetNode.id) return false;
    // When running a subset of nodes, only producers that are actually
    // in the run set can provide a value — the rest won't execute.
    if (runTargetIds && !runTargetIds.includes(n.id)) return false;

    if (
      n.type === "input" ||
      n.type === "capture" ||
      n.type === "read_file" ||
      n.type === "set_variable" ||
      n.type === "http"
    ) {
      return (n.data as { variable: string }).variable?.trim() === varName;
    }
    if (n.type === "note") {
      const explicit = (n.data as { variable?: string }).variable?.trim();
      if (explicit) return explicit === varName;
      const clean = ((n.data as { label?: string }).label || "note")
        .toLowerCase()
        .replace(/[^a-z0-9_]/g, "_")
        .replace(/^_+|_+$/g, "");
      const autoName = clean && clean !== "note" ? `note_${clean}` : "note";
      return autoName === varName;
    }
    if (n.type === "bump_version") {
      return (n.data as { variableOut: string }).variableOut.trim() === varName;
    }
    return false;
  });

  if (producers.length === 0) return false;

  // Traverse active upstream edges from targetNode
  const activeEdges = doc.edges.filter((e) => !e.disabled);
  const upstreamIds = new Set<string>();
  const queue = [targetNode.id];
  const targetFid =
    targetNode.data && "frameId" in targetNode.data ? (targetNode.data.frameId as string) : null;
  if (targetFid) queue.push(targetFid);

  while (queue.length > 0) {
    const current = queue.shift()!;
    for (const edge of activeEdges) {
      if (edge.target === current) {
        if (!upstreamIds.has(edge.source)) {
          upstreamIds.add(edge.source);
          queue.push(edge.source);

          // If source is a frame, also add all its member blocks
          for (const member of doc.nodes) {
            if (member.data && "frameId" in member.data && member.data.frameId === edge.source) {
              if (!upstreamIds.has(member.id)) {
                upstreamIds.add(member.id);
                queue.push(member.id);
              }
            }
          }
        }
      }
    }
  }

  // Is any active producer in the upstream chain?
  return producers.some(
    (p) =>
      upstreamIds.has(p.id) ||
      (p.data &&
        "frameId" in p.data &&
        p.data.frameId &&
        upstreamIds.has(p.data.frameId as string)),
  );
}

/**
 * Ask for any `{{placeholder}}` values the run needs and substitute them in.
 *
 * Returns the document to actually run, or `null` if the user backed out.
 * The substituted commands are never written back to the document — the
 * template is what gets saved, the filled-in copy is what gets executed.
 */
async function withRunInputs(
  doc: WorkflowDocument,
  targetIds?: string[],
): Promise<WorkflowDocument | null> {
  const targets = doc.nodes.filter(
    (n) => n.type !== "frame" && (!targetIds || targetIds.includes(n.id)),
  );

  const fields: string[] = [];
  for (const node of targets) {
    for (const text of placeholderFields(node)) {
      for (const name of placeholdersIn(text)) {
        const provided = isVariableProvidedUpstream(name, node, doc, targetIds);
        if (!provided && !fields.includes(name)) {
          fields.push(name);
        }
      }
    }
  }
  if (fields.length === 0) return doc;

  const values = await useUIStore.getState().askForInputs(
    fields,
    targets
      .filter(
        (n): n is Extract<typeof n, { type: "command" }> =>
          n.type === "command" &&
          placeholdersIn(n.data.command).some((name) => fields.includes(name)),
      )
      .map((n) => ({ id: n.id, label: n.data.label || "Terminal", command: n.data.command })),
  );
  if (!values) return null;

  return {
    ...doc,
    nodes: doc.nodes.map((n) =>
      n.type !== "frame" && (!targetIds || targetIds.includes(n.id)) ? filledNode(n, values) : n,
    ),
  };
}

/** Every field of a block that a `{{placeholder}}` can appear in. */
function placeholderFields(node: PersistedNode): string[] {
  switch (node.type) {
    case "command":
      return [node.data.command];
    case "script":
      return [node.data.script];
    case "condition":
      return [node.data.test];
    case "capture":
      return [node.data.command];
    case "wait":
      return [node.data.until];
    case "http":
      return [node.data.url, node.data.body, ...Object.values(node.data.headers)];
    case "read_file":
      return [node.data.path];
    case "write_file":
      return [node.data.path, node.data.content];
    case "set_variable":
      return [node.data.value];
    case "bump_version":
      return [node.data.variableIn];
    default:
      return [];
  }
}

/**
 * Fill a block's placeholders for this run only.
 *
 * Which escaping applies is a property of where the text lands: a command line
 * gets shell quoting, a script body or a URL gets the value verbatim. Getting
 * that backwards would either break the shell or put stray quotes into Python.
 */
function filledNode(node: PersistedNode, values: InputValues): PersistedNode {
  const shell = (text: string) => fillPlaceholders(text, values);
  const raw = (text: string) => fillPlaceholdersRaw(text, values);

  switch (node.type) {
    case "command":
      return { ...node, data: { ...node.data, command: shell(node.data.command) } };
    case "script":
      return { ...node, data: { ...node.data, script: raw(node.data.script) } };
    case "condition":
      return { ...node, data: { ...node.data, test: shell(node.data.test) } };
    case "capture":
      return { ...node, data: { ...node.data, command: shell(node.data.command) } };
    case "wait":
      return { ...node, data: { ...node.data, until: shell(node.data.until) } };
    case "http":
      return {
        ...node,
        data: {
          ...node.data,
          url: raw(node.data.url),
          body: raw(node.data.body),
          headers: Object.fromEntries(
            Object.entries(node.data.headers).map(([name, value]) => [name, raw(value)]),
          ),
        },
      };
    case "read_file":
      return { ...node, data: { ...node.data, path: raw(node.data.path) } };
    case "write_file":
      return { ...node, data: { ...node.data, path: raw(node.data.path), content: raw(node.data.content) } };
    case "set_variable":
      return { ...node, data: { ...node.data, value: raw(node.data.value) } };
    case "bump_version":
      return { ...node, data: { ...node.data, variableIn: raw(node.data.variableIn) } };
    default:
      return node;
  }
}

export async function runCurrentWorkflow(mode?: import("@/types/workflow").RunMode): Promise<void> {
  const workflow = useWorkflowStore.getState();
  const runtime = useRuntimeStore.getState();
  const ui = useUIStore.getState();
  const effectiveMode = mode ?? runtime.selectedRunMode ?? "live";

  if (runtime.running) return;

  if (workflow.nodes.length === 0) {
    ui.notify("Add a command block first", "error");
    return;
  }

  const doc = await withRunInputs(workflow.toDocument());
  if (!doc) return;

  // Optimistic: closes the window where a double ⌘↵ could start two runs.
  useRuntimeStore.setState({ running: true, error: null, runMode: effectiveMode });
  ui.setOutputOpen(true);

  try {
    await api.runWorkflow(doc, effectiveMode);
  } catch (error) {
    useRuntimeStore.getState().abortLocalRun();
    ui.notify(message(error), "error");
  }
}

/**
 * Run just one frame: its blocks, the wires between them, and the frame
 * itself (which is what supplies the directory). Anything outside is not
 * part of this run, which is the whole reason the button lives on the frame.
 */
export async function runFrame(frameId: string, mode?: import("@/types/workflow").RunMode): Promise<void> {
  const workflow = useWorkflowStore.getState();
  const runtime = useRuntimeStore.getState();
  const ui = useUIStore.getState();
  const effectiveMode = mode ?? runtime.selectedRunMode ?? "live";

  if (runtime.running) return;

  const doc = workflow.toDocument();

  // ONLY include the frame itself and member blocks strictly inside this frame
  const frameNode = doc.nodes.find((n) => n.id === frameId);
  const memberNodes = doc.nodes.filter(
    (n) => n.data && "frameId" in n.data && n.data.frameId === frameId,
  );

  if (memberNodes.length === 0) {
    ui.notify("No blocks inside this frame to run", "error");
    return;
  }

  const includedNodes = frameNode ? [frameNode, ...memberNodes] : memberNodes;
  const includedNodeIds = new Set(includedNodes.map((n) => n.id));

  // Only include active edges connecting blocks strictly within this frame
  const includedEdges = doc.edges.filter(
    (e) => !e.disabled && includedNodeIds.has(e.source) && includedNodeIds.has(e.target),
  );

  const scoped = await withRunInputs(
    {
      ...doc,
      nodes: includedNodes,
      edges: includedEdges,
    },
    memberNodes.map((n) => n.id),
  );
  if (!scoped) return;

  useRuntimeStore.setState({ running: true, error: null, runMode: effectiveMode });
  ui.setOutputOpen(true);

  try {
    await api.runWorkflow(scoped, effectiveMode);
  } catch (error) {
    useRuntimeStore.getState().abortLocalRun();
    ui.notify(message(error), "error");
  }
}

export async function runSingleNode(nodeId: string, mode?: import("@/types/workflow").RunMode): Promise<void> {
  const workflow = useWorkflowStore.getState();
  const runtime = useRuntimeStore.getState();
  const ui = useUIStore.getState();

  if (runtime.running) return;

  const targetNode = workflow.nodes.find((n) => n.id === nodeId);
  if (targetNode && (targetNode.data as any)?.disabled) {
    ui.notify("Cannot run a disabled step. Click Enable to turn it on.", "error");
    return;
  }

  const doc = await withRunInputs(workflow.toDocument(), [nodeId]);
  if (!doc) return;

  useRuntimeStore.setState({ running: true, error: null, runMode: mode ?? "live" });
  ui.inspect(nodeId, { open: true });

  try {
    await api.runNode(doc, nodeId, mode);
  } catch (error) {
    useRuntimeStore.getState().abortLocalRun();
    ui.notify(message(error), "error");
  }
}

export async function applySandboxChangesAction(runId: string): Promise<void> {
  try {
    await api.applySandboxChanges(runId);
    useRuntimeStore.getState().clearSandbox();
    useUIStore.getState().notify("Sandbox changes applied to repository!");
  } catch (error) {
    useUIStore.getState().notify(message(error), "error");
  }
}

export async function discardSandboxAction(runId: string): Promise<void> {
  try {
    await api.discardSandbox(runId);
    useRuntimeStore.getState().clearSandbox();
    useUIStore.getState().notify("Sandbox discarded.");
  } catch (error) {
    useUIStore.getState().notify(message(error), "error");
  }
}

/**
 * Answer the question a paused run is waiting on.
 *
 * The dialog closes immediately rather than waiting for the engine to confirm:
 * the answer is already committed, and leaving the modal up while Rust wakes
 * the run back up reads as an app that did not hear the click.
 */
export async function answerPrompt(
  prompt: PromptRequest,
  reply: PromptReply,
): Promise<void> {
  useRuntimeStore.getState().clearPrompt();

  try {
    await api.resolvePrompt(prompt.runId, prompt.nodeId, reply);
  } catch (error) {
    useUIStore.getState().notify(message(error), "error");
  }
}

export async function stopCurrentRun(): Promise<void> {
  try {
    await api.stopRun();
  } catch (error) {
    useUIStore.getState().notify(message(error), "error");
  }
}

// --- Import / Export ------------------------------------------------------

export async function deleteWorkflowAction(id: string): Promise<void> {
  try {
    await api.deleteWorkflow(id);
    const state = useWorkflowStore.getState();
    if (state.id === id) {
      // If we deleted the active workflow, open a new blank one without saving it to disk yet
      await createNewWorkflow(false);
    }
  } catch (error) {
    useUIStore.getState().notify(message(error), "error");
  }
}

export async function exportWorkflow(): Promise<void> {
  try {
    const doc = useWorkflowStore.getState().toDocument();
    const filePath = await save({
      filters: [{ name: "Fuse Workflow", extensions: ["json"] }],
      defaultPath: `${doc.name}.json`,
    });
    if (!filePath) return;
    
    await writeTextFile(filePath, JSON.stringify(doc, null, 2));
    useUIStore.getState().notify("Workflow exported successfully");
  } catch (error) {
    useUIStore.getState().notify(message(error), "error");
  }
}

export async function importWorkflow(): Promise<void> {
  try {
    const filePath = await open({
      filters: [{ name: "Fuse Workflow", extensions: ["json"] }],
      multiple: false,
      directory: false,
    });
    if (!filePath || Array.isArray(filePath)) return;

    const content = await readTextFile(filePath);
    const doc = JSON.parse(content) as WorkflowDocument;
    
    if (!doc.nodes || !doc.edges) {
      throw new Error("Invalid Fuse workflow format");
    }

    // Generate a new UUID so we don't overwrite existing workflows by mistake
    const newId = uuidv4();
    doc.id = newId;
    doc.name = doc.name.endsWith(" (Imported)") ? doc.name : `${doc.name} (Imported)`;
    
    const saved = await api.saveWorkflow(doc);
    useWorkflowStore.getState().loadDocument(saved);
    rememberLastOpened(saved.id);
    useUIStore.getState().notify(`Imported “${saved.name}”`);
  } catch (error) {
    useUIStore.getState().notify(message(error), "error");
  }
}

export async function exportFrame(frameId: string): Promise<void> {
  try {
    const state = useWorkflowStore.getState();
    const frame = state.nodes.find((n) => n.id === frameId);
    if (!frame) throw new Error("Frame not found");

    const children = state.nodes.filter((n) => n.type !== "frame" && n.data && "frameId" in n.data && (n.data as any).frameId === frameId);
    const nodesToExport = [frame, ...children];
    const nodeIds = new Set(nodesToExport.map((n) => n.id));
    
    const edgesToExport = state.edges.filter(
      (e) => nodeIds.has(e.source) && nodeIds.has(e.target)
    );

    const partialDoc = {
      type: "fuse_export",
      version: 1,
      nodes: nodesToExport,
      edges: edgesToExport,
    };

    const filePath = await save({
      filters: [{ name: "Fuse Export", extensions: ["json"] }],
      defaultPath: `${frame.data.label || "Frame"}.json`,
    });
    if (!filePath) return;
    
    await writeTextFile(filePath, JSON.stringify(partialDoc, null, 2));
    useUIStore.getState().notify("Frame exported successfully");
  } catch (error) {
    useUIStore.getState().notify(message(error), "error");
  }
}

export async function importBlocks(): Promise<void> {
  try {
    const filePath = await open({
      filters: [{ name: "Fuse Export", extensions: ["json"] }],
      multiple: false,
      directory: false,
    });
    if (!filePath || Array.isArray(filePath)) return;

    const content = await readTextFile(filePath);
    const parsed = JSON.parse(content);
    
    // Support both full workflows and partial frame exports
    const nodes: PersistedNode[] = parsed.nodes || [];
    const edges = parsed.edges || [];
    
    if (nodes.length === 0) {
      throw new Error("No blocks found in file");
    }

    // Remap IDs so we can import multiple times without collision
    const idMap = new Map<string, string>();
    nodes.forEach((n) => idMap.set(n.id, uuidv4()));

    const newNodes = nodes.map((n) => {
      const cloned = { ...n, id: idMap.get(n.id)! };
      // Move them down and right slightly so they don't exactly overlap current ones
      cloned.position = { x: cloned.position.x + 30, y: cloned.position.y + 30 };
      if (cloned.type !== "frame" && cloned.data && "frameId" in cloned.data && typeof (cloned.data as any).frameId === "string") {
        const fId = (cloned.data as any).frameId;
        if (idMap.has(fId)) {
          cloned.data = { ...cloned.data, frameId: idMap.get(fId)! };
        } else {
          // Frame wasn't exported, so make it loose
          cloned.data = { ...cloned.data, frameId: null };
        }
      }
      return cloned;
    });

    const newEdges = edges.map((e: any) => ({
      ...e,
      id: uuidv4(),
      source: idMap.get(e.source) || e.source,
      target: idMap.get(e.target) || e.target,
      data: { ...(e.data || {}), disabled: !!(e.data?.disabled ?? e.disabled) },
      disabled: !!(e.data?.disabled ?? e.disabled),
    }));

    useWorkflowStore.setState((state) => ({
      nodes: [...state.nodes, ...newNodes],
      edges: [...state.edges, ...newEdges],
      dirty: true,
    }));
    
    useUIStore.getState().notify("Blocks imported successfully");
  } catch (error) {
    useUIStore.getState().notify(message(error), "error");
  }
}

export type ImportJsonMode = "new_workflow" | "insert_blocks" | "replace_current";

/**
 * Imports raw JSON text as a new workflow, inserted blocks, or by replacing the current canvas.
 */
export async function importJsonString(
  jsonStr: string,
  mode: ImportJsonMode,
  options?: { position?: { x: number; y: number } },
): Promise<boolean> {
  try {
    const res = parseFuseJson(jsonStr);
    if (!res.valid || !res.data) {
      throw new Error(res.error || "Failed to parse JSON.");
    }

    const { data } = res;

    if (mode === "new_workflow") {
      const newId = uuidv4();
      const name = data.name
        ? (data.name.endsWith(" (Imported)") ? data.name : `${data.name} (Imported)`)
        : "Imported Workflow";

      const doc: WorkflowDocument = {
        id: newId,
        name,
        workingDir: data.workingDir ?? null,
        nodes: data.nodes,
        edges: data.edges,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };

      const saved = await api.saveWorkflow(doc);
      useWorkflowStore.getState().loadDocument(saved);
      useRuntimeStore.getState().clearAll();
      useUIStore.getState().inspect(null, { open: false });
      rememberLastOpened(saved.id);
      useUIStore.getState().notify(`Imported “${saved.name}”`);
      return true;
    }

    if (mode === "replace_current") {
      const current = useWorkflowStore.getState();
      useWorkflowStore.getState().beginEdit();

      const doc: WorkflowDocument = {
        id: current.id,
        name: data.name || current.name,
        workingDir: data.workingDir ?? current.workingDir,
        nodes: data.nodes,
        edges: data.edges,
        createdAt: current.createdAt || Date.now(),
        updatedAt: Date.now(),
      };

      useWorkflowStore.getState().loadDocument(doc);
      useWorkflowStore.setState({ dirty: true });
      useUIStore
        .getState()
        .notify(`Workflow replaced with ${data.nodes.length} block${data.nodes.length === 1 ? "" : "s"}`);
      return true;
    }

    if (mode === "insert_blocks") {
      const pos = options?.position ?? getCanvasSpawnPoint();
      const prepared = prepareImportedNodesAndEdges(data, pos);

      useWorkflowStore.getState().beginEdit();

      const currentNodes = useWorkflowStore.getState().nodes;
      const currentEdges = useWorkflowStore.getState().edges;

      const newNodes = prepared.nodes.map((n) => {
        if (n.type === "frame") {
          return {
            id: n.id,
            type: "frame" as const,
            position: n.position,
            width: (n.data as any)?.width ?? 480,
            height: (n.data as any)?.height ?? 360,
            zIndex: 0,
            data: n.data,
          };
        }
        return {
          id: n.id,
          type: n.type,
          position: n.position,
          zIndex: 1,
          data: n.data,
        };
      }) as import("@/types/workflow").FuseNode[];

      const newEdges = prepared.edges.map((e) => ({
        id: e.id,
        source: e.source,
        target: e.target,
        sourceHandle: e.sourceHandle ?? SOURCE_PORT,
        targetHandle: e.targetHandle ?? TARGET_PORT,
        type: "flow" as const,
        data: { disabled: !!e.disabled },
        disabled: !!e.disabled,
      })) as import("@/types/workflow").FuseEdge[];

      useWorkflowStore.setState({
        nodes: [...currentNodes, ...newNodes],
        edges: [...currentEdges, ...newEdges],
        dirty: true,
      });

      useWorkflowStore.getState().recomputeFrames();
      useUIStore
        .getState()
        .notify(`Added ${prepared.nodes.length} block${prepared.nodes.length === 1 ? "" : "s"} to canvas`);
      return true;
    }

    return false;
  } catch (error) {
    useUIStore.getState().notify(message(error), "error");
    return false;
  }
}

/**
 * Attempts to read the system clipboard and paste valid Fuse JSON directly onto the canvas.
 */
export async function pasteJsonFromClipboard(
  position?: { x: number; y: number },
): Promise<boolean> {
  try {
    if (!navigator.clipboard || !navigator.clipboard.readText) {
      useUIStore.getState().notify("Clipboard access not available in this browser window", "error");
      return false;
    }

    const text = await navigator.clipboard.readText();
    if (!text || !text.trim()) {
      useUIStore.getState().notify("Clipboard is empty", "error");
      return false;
    }

    const res = parseFuseJson(text);
    if (!res.valid || !res.data) {
      useUIStore.getState().notify(res.error || "Clipboard does not contain valid Fuse JSON", "error");
      return false;
    }

    return await importJsonString(text, "insert_blocks", { position });
  } catch (error) {
    useUIStore.getState().notify(message(error), "error");
    return false;
  }
}

