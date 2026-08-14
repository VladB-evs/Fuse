import { create } from "zustand";

export type InputValues = Record<string, string>;

/** Just enough of a block to show what a value will do to it. */
export type InputPreviewBlock = { id: string; label: string; command: string };

type InputRequest = {
  fields: string[];
  blocks: InputPreviewBlock[];
  resolve: (values: InputValues | null) => void;
};

/**
 * An open node picker.
 *
 * `at` is where on screen to put the panel, `position` where on the canvas the
 * block should land, and `connectFrom` the block whose wire was dropped on
 * empty canvas — the new block is wired to it as soon as it is chosen.
 */
export type PickerRequest = {
  at: { x: number; y: number };
  position: { x: number; y: number };
  connectFrom?: { nodeId: string; handleId: string | null; backwards: boolean };
};

export type UIState = {
  /** Node whose output the panel is showing. */
  inspectedNodeId: string | null;
  outputOpen: boolean;
  paletteOpen: boolean;
  docsOpen: boolean;
  /** The rename dialog — the only place the workflow name is edited. */
  renameOpen: boolean;
  settingsOpen: boolean;
  /** Frame a dragged block would join if dropped now, so it can light up. */
  dropFrameId: string | null;
  /** A run waiting on values for the {{placeholders}} in its commands. */
  inputRequest: InputRequest | null;
  /** Set right after a block is created so the canvas can focus its input. */
  pendingFocusId: string | null;
  /** While true the output panel follows whichever block is executing. */
  followRun: boolean;
  /** Transient message shown in the toolbar. */
  toast: { text: string; tone: "info" | "error" } | null;
  /** The node picker, when it is open. */
  picker: PickerRequest | null;
  leftSidebarOpen: boolean;
  rightSidebarOpen: boolean;

  inspect: (nodeId: string | null, options?: { open?: boolean; manual?: boolean }) => void;
  setFollowRun: (follow: boolean) => void;
  setOutputOpen: (open: boolean) => void;
  toggleOutput: () => void;
  toggleLeftSidebar: () => void;
  toggleRightSidebar: () => void;
  setPaletteOpen: (open: boolean) => void;
  setDocsOpen: (open: boolean) => void;
  setSettingsOpen: (open: boolean) => void;
  setRenameOpen: (open: boolean) => void;
  setDropFrame: (frameId: string | null) => void;
  /** Resolves with the entered values, or `null` if the run was called off. */
  askForInputs: (fields: string[], blocks: InputPreviewBlock[]) => Promise<InputValues | null>;
  answerInputs: (values: InputValues | null) => void;
  requestFocus: (nodeId: string) => void;
  consumeFocus: () => void;
  notify: (text: string, tone?: "info" | "error") => void;
  openPicker: (request: PickerRequest) => void;
  closePicker: () => void;
};

let toastTimer: ReturnType<typeof setTimeout> | undefined;

export const useUIStore = create<UIState>()((set) => ({
  inspectedNodeId: null,
  outputOpen: false,
  paletteOpen: false,
  docsOpen: false,
  settingsOpen: false,
  renameOpen: false,
  dropFrameId: null,
  inputRequest: null,
  pendingFocusId: null,
  followRun: true,
  toast: null,
  picker: null,
  leftSidebarOpen: true,
  rightSidebarOpen: false,

  inspect: (nodeId, options) =>
    set((state) => ({
      inspectedNodeId: nodeId,
      outputOpen: options?.open ?? state.outputOpen,
      // Picking a block by hand takes the panel off auto-follow.
      followRun: options?.manual ? false : state.followRun,
    })),

  setFollowRun: (follow) => set({ followRun: follow }),

  setOutputOpen: (open) => set({ outputOpen: open }),
  toggleOutput: () => set((s) => ({ outputOpen: !s.outputOpen })),
  
  toggleLeftSidebar: () => set((s) => ({ leftSidebarOpen: !s.leftSidebarOpen })),
  toggleRightSidebar: () => set((s) => ({ rightSidebarOpen: !s.rightSidebarOpen })),
  setPaletteOpen: (open) => set({ paletteOpen: open }),
  setDocsOpen: (open) => set({ docsOpen: open }),
  setSettingsOpen: (open) => set({ settingsOpen: open }),
  setRenameOpen: (open) => set({ renameOpen: open }),

  setDropFrame: (frameId) =>
    set((state) => (state.dropFrameId === frameId ? state : { dropFrameId: frameId })),

  askForInputs: (fields, blocks) =>
    new Promise<InputValues | null>((resolve) => {
      set({ inputRequest: { fields, blocks, resolve } });
    }),

  answerInputs: (values) =>
    set((state) => {
      state.inputRequest?.resolve(values);
      return { inputRequest: null };
    }),

  requestFocus: (nodeId) => set({ pendingFocusId: nodeId }),
  consumeFocus: () => set({ pendingFocusId: null }),

  // Opening the picker closes the palette: two stacked overlays is exactly
  // the muddle the picker exists to replace.
  openPicker: (request) => set({ picker: request, paletteOpen: false }),
  closePicker: () => set({ picker: null }),

  notify: (text, tone = "info") => {
    clearTimeout(toastTimer);
    set({ toast: { text, tone } });
    toastTimer = setTimeout(() => set({ toast: null }), tone === "error" ? 5000 : 2200);
  },
}));
