import { useEffect, useRef } from "react";
import { useReactFlow } from "@xyflow/react";
import { useUIStore } from "@/store/uiStore";
import { useWorkflowStore } from "@/store/workflowStore";
import { useRuntimeStore } from "@/store/runtimeStore";
import {
  addCommandBlock,
  addFrameBlock,
  createNewWorkflow,
  disconnectSelection,
  openNodePicker,
  runCurrentWorkflow,
  saveCurrentWorkflow,
  stopCurrentRun,
} from "@/lib/actions";

/**
 * Text editing always wins. Anything that would clash with typing inside a
 * command (undo, delete, plain letters) is suppressed while an input has
 * focus — only unambiguous ⌘ combinations pass through.
 */
function isTyping(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || el.isContentEditable;
}

export function useKeyboardShortcuts() {
  const { zoomIn, zoomOut, fitView } = useReactFlow();

  // Where the picker should open when it is summoned by key rather than click.
  const pointer = useRef<{ x: number; y: number } | undefined>(undefined);

  useEffect(() => {
    const onMove = (event: MouseEvent) => {
      pointer.current = { x: event.clientX, y: event.clientY };
    };
    window.addEventListener("mousemove", onMove);
    return () => window.removeEventListener("mousemove", onMove);
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const mod = event.metaKey || event.ctrlKey;
      const typing = isTyping(event.target);
      const ui = useUIStore.getState();

      // --- Always available, even mid-typing --------------------------------
      if (mod && event.key === "k") {
        event.preventDefault();
        ui.setPaletteOpen(!ui.paletteOpen);
        return;
      }

      if (mod && event.key === "Enter") {
        event.preventDefault();
        void runCurrentWorkflow();
        return;
      }

      if (mod && event.key === "s") {
        event.preventDefault();
        void saveCurrentWorkflow();
        return;
      }

      if (mod && event.key === ".") {
        event.preventDefault();
        if (useRuntimeStore.getState().running) void stopCurrentRun();
        return;
      }

      if (mod && event.key === "/") {
        event.preventDefault();
        ui.toggleOutput();
        return;
      }

      if (mod && (event.key === "=" || event.key === "+")) {
        event.preventDefault();
        zoomIn({ duration: 160 });
        return;
      }

      if (mod && event.key === "-") {
        event.preventDefault();
        zoomOut({ duration: 160 });
        return;
      }

      if (mod && event.key === "0") {
        event.preventDefault();
        fitView({ padding: 0.3, duration: 240, maxZoom: 1 });
        return;
      }

      if (mod && event.key === "n") {
        event.preventDefault();
        void createNewWorkflow();
        return;
      }

      if (mod && event.key === "o") {
        event.preventDefault();
        ui.setPaletteOpen(true);
        return;
      }

      // --- Suppressed while typing -----------------------------------------
      if (typing) return;

      // Tab is the add-a-block key in every node editor worth copying. It
      // opens the picker under the pointer, so the block lands where you are
      // already looking.
      if (!mod && event.key === "Tab") {
        event.preventDefault();
        openNodePicker(pointer.current);
        return;
      }

      // ⇧⌫ cuts the wires around the selection without deleting the blocks.
      if (event.shiftKey && (event.key === "Backspace" || event.key === "Delete")) {
        event.preventDefault();
        disconnectSelection();
        return;
      }

      if (mod && event.key.toLowerCase() === "z") {
        event.preventDefault();
        const workflow = useWorkflowStore.getState();
        if (event.shiftKey) workflow.redo();
        else workflow.undo();
        return;
      }

      if (mod && event.key === "d") {
        event.preventDefault();
        useWorkflowStore.getState().duplicateSelected();
        return;
      }

      if (!mod && (event.key === "Backspace" || event.key === "Delete")) {
        event.preventDefault();
        useWorkflowStore.getState().deleteSelected();
        return;
      }

      // Bare "a" adds a block — the fastest path to a new command.
      if (!mod && !event.altKey && event.key === "a") {
        event.preventDefault();
        addCommandBlock();
        return;
      }

      // Bare "f" drops a frame to group blocks under one folder.
      if (!mod && !event.altKey && event.key === "f") {
        event.preventDefault();
        addFrameBlock();
        return;
      }

      // Bare "m" toggles the canvas minimap
      if (!mod && !event.altKey && event.key.toLowerCase() === "m") {
        event.preventDefault();
        ui.toggleMinimap();
        return;
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [zoomIn, zoomOut, fitView]);
}
