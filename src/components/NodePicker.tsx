import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useUIStore } from "@/store/uiStore";
import { Kbd } from "@/components/ui/Kbd";
import { addNodeOfKind } from "@/lib/actions";
import {
  ACCENT_TEXT,
  ACCENT_TINT,
  CATEGORY_THEME,
  searchCatalog,
  type CatalogEntry,
} from "@/lib/catalog";
import { cn } from "@/lib/utils";

const PANEL = { width: 320, maxHeight: 392 };

/**
 * The one place blocks are added from.
 *
 * It opens where you are working rather than in the middle of the screen: at
 * the pointer when you press Tab, under the button when you click Add, and at
 * the loose end of a wire when you drop one on empty canvas — in which case
 * the block it creates is already connected.
 *
 * Every kind is on one screen, grouped and described, because "what can this
 * app even do" should be answerable by looking rather than by remembering.
 */
export function NodePicker() {
  const request = useUIStore((s) => s.picker);
  const close = useUIStore((s) => s.closePicker);

  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const panelRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const results = useMemo(() => searchCatalog(query), [query]);

  // A new query starts from the top, or the highlight ends up off the list.
  useEffect(() => setActive(0), [query]);

  useEffect(() => {
    if (!request) setQuery("");
  }, [request]);

  // Keep the panel on screen when it opens near an edge.
  useLayoutEffect(() => {
    const el = panelRef.current;
    if (!el || !request) return;

    const { innerWidth, innerHeight } = window;
    const x = Math.min(request.at.x, innerWidth - PANEL.width - 12);
    const y = Math.min(request.at.y, innerHeight - PANEL.maxHeight - 12);
    el.style.left = `${Math.max(12, x)}px`;
    el.style.top = `${Math.max(12, y)}px`;
  }, [request]);

  useEffect(() => {
    listRef.current
      ?.querySelector<HTMLElement>('[data-active="true"]')
      ?.scrollIntoView({ block: "nearest" });
  }, [active]);

  if (!request) return null;

  const choose = (entry: CatalogEntry) => {
    close();
    addNodeOfKind(entry.kind, request.position, request.connectFrom, entry.prefill);
  };

  return (
    <div
      className="fixed inset-0 z-50"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) close();
      }}
    >
      <div
        ref={panelRef}
        className={cn(
          "animate-in-soft absolute flex flex-col overflow-hidden",
          "rounded-[10px] border border-line-strong bg-base",
          "shadow-[0_18px_50px_-12px_rgba(0,0,0,0.85)]",
        )}
        style={{ width: PANEL.width, maxHeight: PANEL.maxHeight }}
        onKeyDown={(event) => {
          event.stopPropagation();
          if (event.key === "Escape") {
            event.preventDefault();
            close();
            return;
          }
          if (event.key === "ArrowDown" || (event.key === "Tab" && !event.shiftKey)) {
            event.preventDefault();
            setActive((current) => (current + 1) % Math.max(results.length, 1));
            return;
          }
          if (event.key === "ArrowUp" || (event.key === "Tab" && event.shiftKey)) {
            event.preventDefault();
            setActive((current) => (current - 1 + results.length) % Math.max(results.length, 1));
            return;
          }
          if (event.key === "Enter") {
            event.preventDefault();
            const entry = results[active];
            if (entry) choose(entry);
          }
        }}
      >
        <div className="flex items-center gap-2 border-b border-line px-2.5">
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.currentTarget.value)}
            placeholder={request.connectFrom ? "Connect to…" : "Add a block…"}
            className="h-9 flex-1 bg-transparent text-[12.5px] text-fg outline-none placeholder:text-fg-subtle"
          />
          {request.connectFrom && (
            <span className="shrink-0 rounded-[4px] bg-accent/12 px-1.5 py-0.5 text-[10px] text-accent">
              wires up
            </span>
          )}
        </div>

        <div ref={listRef} className="min-h-0 flex-1 overflow-y-auto p-1">
          {results.length === 0 && (
            <p className="px-2.5 py-6 text-center text-[12px] text-fg-subtle">
              Nothing matches “{query}”
            </p>
          )}

          {results.map((entry, index) => {
            const first = index === 0 || results[index - 1]!.group !== entry.group;
            const Icon = entry.icon;

            return (
              <div key={entry.label}>
                {first && !query && (
                  <div className="flex items-center gap-1.5 px-2 pt-2.5 pb-1">
                    <span
                      className={cn(
                        "px-1.5 py-0.5 rounded-[4px] font-mono text-[9px] font-bold tracking-wider uppercase",
                        CATEGORY_THEME[entry.group]?.badge,
                      )}
                    >
                      {entry.group}
                    </span>
                    <span className="h-px flex-1 bg-line/60" />
                  </div>
                )}
                <button
                  type="button"
                  data-active={index === active}
                  onMouseEnter={() => setActive(index)}
                  onClick={() => choose(entry)}
                  className={cn(
                    "flex w-full items-start gap-2 rounded-[7px] px-2 py-1.5 text-left transition",
                    index === active ? "bg-hover" : "hover:bg-hover/60",
                  )}
                >
                  <span
                    className={cn(
                      "mt-px flex size-[22px] shrink-0 items-center justify-center rounded-[6px]",
                      ACCENT_TINT[entry.accent],
                    )}
                  >
                    <Icon
                      size={12}
                      strokeWidth={1.75}
                      className={ACCENT_TEXT[entry.accent]}
                    />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-1.5">
                      <span className="truncate text-[12.5px] text-fg">{entry.label}</span>
                      <span className="truncate text-[11px] text-fg-subtle">{entry.summary}</span>
                    </span>
                    <span className="block truncate text-[10.5px] leading-[14px] text-fg-subtle/85">
                      {entry.detail}
                    </span>
                  </span>
                  {entry.shortcut && (
                    <span className="mt-px shrink-0">
                      <Kbd>{entry.shortcut}</Kbd>
                    </span>
                  )}
                </button>
              </div>
            );
          })}
        </div>

        <div className="flex h-7 shrink-0 items-center gap-2.5 border-t border-line px-2.5 text-[10px] text-fg-subtle">
          <span className="flex items-center gap-1">
            <Kbd>↑</Kbd>
            <Kbd>↓</Kbd> move
          </span>
          <span className="flex items-center gap-1">
            <Kbd>↵</Kbd> add
          </span>
          <span className="flex items-center gap-1">
            <Kbd>esc</Kbd> close
          </span>
        </div>
      </div>
    </div>
  );
}
