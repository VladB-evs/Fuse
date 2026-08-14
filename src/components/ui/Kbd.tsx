import { cn } from "@/lib/utils";

/** Small macOS-style key hint, e.g. ⌘K */
export function Kbd({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <kbd
      className={cn(
        "inline-flex h-[17px] min-w-[17px] items-center justify-center rounded-[4px] border border-line",
        "bg-elevated px-1 font-sans text-[10px] leading-none font-medium text-fg-subtle",
        className,
      )}
    >
      {children}
    </kbd>
  );
}
