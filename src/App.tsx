import { useEffect, useState } from "react";
import { ReactFlowProvider } from "@xyflow/react";
import { Canvas } from "@/canvas/Canvas";
import { Toolbar } from "@/components/Toolbar";
import { OutputPanel } from "@/components/OutputPanel";
import { CommandPalette } from "@/components/CommandPalette";
import { RenameDialog } from "@/components/RenameDialog";
import { RunInputDialog } from "@/components/RunInputDialog";
import { PromptDialog } from "@/components/PromptDialog";
import { NodePicker } from "@/components/NodePicker";
import { WorkflowSidebar } from "@/components/WorkflowSidebar";
import { RepositoryActivityPanel } from "@/components/RepositoryActivityPanel";
import { DocumentationDialog } from "@/components/DocumentationDialog";
import { SettingsDialog } from "@/components/SettingsDialog";
import { useKeyboardShortcuts } from "@/hooks/useKeyboardShortcuts";
import { subscribeToEngine } from "@/bridge/events";
import { homeDirectory, listWorkflows } from "@/bridge/commands";
import { autosaveWorkflow, lastOpenedId, openWorkflowById } from "@/lib/actions";
import { useRuntimeStore } from "@/store/runtimeStore";
import { useUIStore } from "@/store/uiStore";
import { useWorkflowStore } from "@/store/workflowStore";

const AUTOSAVE_DELAY = 1200;

export default function App() {
  return (
    <ReactFlowProvider>
      <AppShell />
    </ReactFlowProvider>
  );
}

function AppShell() {
  useKeyboardShortcuts();

  const [homeDir, setHomeDir] = useState("");

  const dirty = useWorkflowStore((s) => s.dirty);
  const nodes = useWorkflowStore((s) => s.nodes);
  const edges = useWorkflowStore((s) => s.edges);
  const name = useWorkflowStore((s) => s.name);
  const workingDir = useWorkflowStore((s) => s.workingDir);
  const leftSidebarOpen = useUIStore((s) => s.leftSidebarOpen);
  const rightSidebarOpen = useUIStore((s) => s.rightSidebarOpen);

  // Engine events -> runtime store, plus output-panel follow behaviour.
  useEffect(() => {
    let dispose: (() => void) | undefined;
    let cancelled = false;

    void subscribeToEngine((events) => {
      useRuntimeStore.getState().applyEvents(events);

      for (const event of events) {
        if (event.event === "runStarted") {
          useUIStore.getState().setFollowRun(true);
        }
        if (event.event === "nodeStarted" && useUIStore.getState().followRun) {
          useUIStore.getState().inspect(event.nodeId);
        }
        // A run that has stopped to ask something should have the step it is
        // asking about on screen behind the dialog.
        if (event.event === "nodeWaiting") {
          useUIStore.getState().inspect(event.prompt.sources[0] ?? event.nodeId, { open: true });
        }
        if (event.event === "runFinished" && event.status === "failed") {
          // Land the user on the block that actually broke.
          const { order, statuses } = useRuntimeStore.getState();
          const failed = order.find((id) => statuses[id] === "failed");
          if (failed) useUIStore.getState().inspect(failed, { open: true });
        }
      }
    }).then((unlisten) => {
      if (cancelled) unlisten();
      else dispose = unlisten;
    });

    return () => {
      cancelled = true;
      dispose?.();
    };
  }, []);

  // Restore the last workflow so reopening Fuse picks up where you left off.
  useEffect(() => {
    void (async () => {
      try {
        setHomeDir(await homeDirectory());
      } catch {
        // Non-fatal: paths just render unabbreviated.
      }

      try {
        const saved = await listWorkflows();
        const remembered = lastOpenedId();
        const target =
          remembered && saved.some((w) => w.id === remembered)
            ? remembered
            : saved[0]?.id;
        if (target) await openWorkflowById(target);
      } catch {
        // First launch with no store yet — start on a blank canvas.
      }
    })();
  }, []);

  // Debounced autosave. ⌘S still works and confirms; this is the safety net.
  useEffect(() => {
    if (!dirty) return;
    const timer = setTimeout(() => void autosaveWorkflow(), AUTOSAVE_DELAY);
    return () => clearTimeout(timer);
  }, [dirty, nodes, edges, name, workingDir]);

  // Desktop app, not a web page: no browser context menu on chrome.
  useEffect(() => {
    const onContextMenu = (event: MouseEvent) => {
      const el = event.target as HTMLElement | null;
      const editable =
        el?.tagName === "INPUT" || el?.tagName === "TEXTAREA" || el?.isContentEditable;
      if (!editable) event.preventDefault();
    };
    window.addEventListener("contextmenu", onContextMenu);
    return () => window.removeEventListener("contextmenu", onContextMenu);
  }, []);

  return (
    <div className="flex h-full flex-col bg-canvas">
      <Toolbar />
      <div className="flex min-h-0 flex-1">
        {leftSidebarOpen && <WorkflowSidebar />}
        <Canvas />
        {rightSidebarOpen && (
          <RepositoryActivityPanel directory={workingDir} homeDir={homeDir} />
        )}
      </div>
      <OutputPanel homeDir={homeDir} />
      <NodePicker />
      <CommandPalette />
      <RenameDialog />
      <RunInputDialog />
      <PromptDialog />
      <DocumentationDialog />
      <SettingsDialog />
    </div>
  );
}
