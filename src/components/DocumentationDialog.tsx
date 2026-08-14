import { useEffect } from "react";
import { BookOpen, Copy, X } from "lucide-react";
import { useUIStore } from "@/store/uiStore";
import { CATALOG, ACCENT_TINT, ACCENT_TEXT } from "@/lib/catalog";
import { Button } from "./ui/Button";
import { cn } from "@/lib/utils";

export function DocumentationDialog() {
  const open = useUIStore((s) => s.docsOpen);
  const setOpen = useUIStore((s) => s.setDocsOpen);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && open) {
        setOpen(false);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [open, setOpen]);

  if (!open) return null;

  const copyForAI = () => {
    const text = CATALOG.map((entry) => 
      `${entry.label} (${entry.kind}): ${entry.summary}\n${entry.documentation.what}`
    ).join("\n\n");
    navigator.clipboard.writeText(text);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) setOpen(false);
      }}
    >
      <div className="absolute inset-0 bg-canvas/55 backdrop-blur-[2px]" aria-hidden />

      <div className="animate-in-soft relative flex h-full max-h-[85vh] w-full max-w-[800px] flex-col rounded-xl border border-line-strong bg-base shadow-[0_18px_50px_-12px_rgba(0,0,0,0.8)] overflow-hidden">
        <div className="flex shrink-0 items-center justify-between border-b border-line px-5 py-4">
          <h2 className="flex items-center gap-2 text-lg font-semibold tracking-tight text-fg">
            <BookOpen size={20} className="text-fg-muted" />
            Block Documentation
          </h2>
          <div className="flex items-center gap-2">
            <Button variant="subtle" onClick={copyForAI} title="Copy catalog for AI">
              <Copy size={14} />
              Copy for AI
            </Button>
            <button
              onClick={() => setOpen(false)}
              className="flex items-center justify-center rounded-[6px] p-1.5 text-fg-subtle transition hover:bg-hover hover:text-fg"
            >
              <X size={16} />
            </button>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto pb-10">
          {Object.entries(
            CATALOG.reduce((acc, entry) => {
              if (!acc[entry.group]) acc[entry.group] = [];
              acc[entry.group]!.push(entry);
              return acc;
            }, {} as Record<string, typeof CATALOG>)
          ).map(([group, entries]) => (
            <div key={group}>
              <h3 className="sticky top-0 z-10 bg-base/95 px-5 py-2 text-[11px] font-bold tracking-wider text-fg-subtle uppercase backdrop-blur-sm shadow-[0_1px_0_0_var(--color-line)]">
                {group}
              </h3>
              <div className="space-y-8 px-5 py-6">
                {entries.map((entry) => (
                  <div key={entry.kind} className="space-y-3 pb-8 border-b border-line-subtle last:border-0 text-left">
                    <div className="flex w-full items-start gap-2 text-left">
                      <span
                        className={cn(
                          "mt-px flex size-[22px] shrink-0 items-center justify-center rounded-[6px]",
                          ACCENT_TINT[entry.accent],
                        )}
                      >
                        <entry.icon size={12} strokeWidth={1.75} className={ACCENT_TEXT[entry.accent]} />
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
                    </div>
                    <div className="grid gap-6 pt-3 text-[12.5px] sm:grid-cols-2">
                      <div className="space-y-1.5">
                        <strong className="block text-fg font-semibold">What it is</strong>
                        <p className="text-fg-subtle leading-relaxed">{entry.documentation.what}</p>
                      </div>
                      <div className="space-y-1.5">
                        <strong className="block text-fg font-semibold">When to use it</strong>
                        <p className="text-fg-subtle leading-relaxed">{entry.documentation.when}</p>
                      </div>
                    </div>
                    <div className="pt-2">
                      <strong className="block text-fg text-[12.5px] font-semibold mb-1.5">Example</strong>
                      <pre className="bg-canvas/50 border border-line rounded-[6px] px-3 py-2 text-xs text-fg-subtle overflow-x-auto font-mono">
                        {entry.documentation.example}
                      </pre>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
