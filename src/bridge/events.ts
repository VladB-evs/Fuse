import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type { EngineEvent } from "@/types/workflow";

const ENGINE_CHANNEL = "fuse://engine";

/**
 * Subscribe to engine progress.
 *
 * Events are coalesced into one batch per animation frame. A command like
 * `npm install` can emit thousands of lines a second; without batching every
 * line would be its own React render and the canvas would stutter.
 */
export async function subscribeToEngine(
  onBatch: (events: EngineEvent[]) => void,
): Promise<UnlistenFn> {
  let queue: EngineEvent[] = [];
  let frame = 0;

  const flush = () => {
    frame = 0;
    if (queue.length === 0) return;
    const batch = queue;
    queue = [];
    onBatch(batch);
  };

  const unlisten = await listen<EngineEvent>(ENGINE_CHANNEL, (message) => {
    queue.push(message.payload);
    if (!frame) frame = requestAnimationFrame(flush);
  });

  return () => {
    if (frame) cancelAnimationFrame(frame);
    flush();
    unlisten();
  };
}
