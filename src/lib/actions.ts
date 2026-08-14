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
  type PersistedNode,
  type PromptReply,
  type PromptRequest,
  type WorkflowDocument,
} from "@/types/workflow";
import { SOURCE_PORT, TARGET_PORT } from "@/canvas/ports";
import { catalogEntry } from "@/lib/catalog";
import { fillPlaceholders, fillPlaceholdersRaw, placeholdersIn } from "@/lib/placeholders";


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

export async function createNewWorkflow(): Promise<WorkflowDocument | null> {
  await autosaveWorkflow();
  try {
    useWorkflowStore.getState().resetWorkflow();
    const saved = await api.saveWorkflow(useWorkflowStore.getState().toDocument());
    useWorkflowStore.getState().markSaved(saved);
    useRuntimeStore.getState().clearAll();
    useUIStore.getState().inspect(null, { open: false });
    rememberLastOpened(saved.id);
    useUIStore.getState().notify("New workflow created");
    return saved;
  } catch (error) {
    useUIStore.getState().notify(message(error), "error");
    return null;
  }
}

// --- Editing --------------------------------------------------------------

export function addCommandBlock(position?: { x: number; y: number }): string {
  const id = useWorkflowStore.getState().addBlockNode("command", position ? { position } : undefined);
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
): string {
  const workflow = useWorkflowStore.getState();

  if (kind === "frame") {
    const id = workflow.addFrameNode(position ? { position } : undefined);
    useUIStore.getState().notify("Frame added — set its folder to run it");
    return id;
  }

  // A wire dropped on empty canvas already said where the block goes, so it
  // must not also chain itself onto whatever happened to be selected.
  const id = workflow.addBlockNode(kind, position ? { position } : undefined);

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
  const point = at ?? { x: window.innerWidth / 2 - 160, y: window.innerHeight / 3 };
  useUIStore.getState().openPicker({ at: point, position: canvasPoint(point) });
}

/**
 * Screen point -> canvas point.
 *
 * Set by the canvas on mount; without it the picker still works, it just drops
 * blocks where the store would have put them anyway.
 */
let canvasPoint: (point: { x: number; y: number }) => { x: number; y: number } = (point) => point;

export function setCanvasProjection(project: typeof canvasPoint) {
  canvasPoint = project;
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
  return useWorkflowStore.getState().addFrameNode(position ? { position } : undefined);
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

  // Anything an ask or capture step will produce during the run is not asked
  // for now — deciding it up front would defeat the point of those steps.
  const filledLater = new Set(
    doc.nodes
      .filter((n) => n.type === "input" || n.type === "capture")
      .map((n) => (n.data as { variable: string }).variable.trim())
      .filter(Boolean),
  );

  const fields: string[] = [];
  for (const node of targets) {
    for (const text of placeholderFields(node)) {
      for (const name of placeholdersIn(text)) {
        if (!filledLater.has(name) && !fields.includes(name)) fields.push(name);
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
    default:
      return node;
  }
}

export async function runCurrentWorkflow(): Promise<void> {
  const workflow = useWorkflowStore.getState();
  const runtime = useRuntimeStore.getState();
  const ui = useUIStore.getState();

  if (runtime.running) return;

  if (workflow.nodes.length === 0) {
    ui.notify("Add a command block first", "error");
    return;
  }

  const doc = await withRunInputs(workflow.toDocument());
  if (!doc) return;

  // Optimistic: closes the window where a double ⌘↵ could start two runs.
  useRuntimeStore.setState({ running: true, error: null });
  ui.setOutputOpen(true);

  try {
    await api.runWorkflow(doc);
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
export async function runFrame(frameId: string): Promise<void> {
  const workflow = useWorkflowStore.getState();
  const runtime = useRuntimeStore.getState();
  const ui = useUIStore.getState();

  if (runtime.running) return;

  const doc = workflow.toDocument();

  const reachableFrames = new Set<string>([frameId]);
  let added = true;
  while (added) {
    added = false;
    for (const edge of doc.edges) {
      if (reachableFrames.has(edge.source) && !reachableFrames.has(edge.target)) {
        const targetNode = doc.nodes.find((n) => n.id === edge.target);
        if (targetNode?.type === "frame") {
          reachableFrames.add(edge.target);
          added = true;
        }
      }
    }
  }

  const members = doc.nodes.filter(
    (n) => n.type !== "frame" && n.data.frameId && reachableFrames.has(n.data.frameId),
  );

  if (members.length === 0) {
    ui.notify("No blocks to run in this frame sequence", "error");
    return;
  }

  const memberIds = new Set(members.map((n) => n.id));
  const frames = doc.nodes.filter((n) => reachableFrames.has(n.id));
  const includedIds = new Set([...memberIds, ...reachableFrames]);

  const scoped = await withRunInputs(
    {
      ...doc,
      nodes: [...frames, ...members],
      edges: doc.edges.filter((e) => includedIds.has(e.source) && includedIds.has(e.target)),
    },
    [...memberIds],
  );
  if (!scoped) return;

  useRuntimeStore.setState({ running: true, error: null });
  ui.setOutputOpen(true);

  try {
    await api.runWorkflow(scoped);
  } catch (error) {
    useRuntimeStore.getState().abortLocalRun();
    ui.notify(message(error), "error");
  }
}

export async function runSingleNode(nodeId: string): Promise<void> {
  const workflow = useWorkflowStore.getState();
  const runtime = useRuntimeStore.getState();
  const ui = useUIStore.getState();

  if (runtime.running) return;

  const doc = await withRunInputs(workflow.toDocument(), [nodeId]);
  if (!doc) return;

  useRuntimeStore.setState({ running: true, error: null });
  ui.inspect(nodeId, { open: true });

  try {
    await api.runNode(doc, nodeId);
  } catch (error) {
    useRuntimeStore.getState().abortLocalRun();
    ui.notify(message(error), "error");
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
