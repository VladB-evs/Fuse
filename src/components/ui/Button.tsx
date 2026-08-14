import { forwardRef } from "react";
import { cn } from "@/lib/utils";

type Variant = "primary" | "ghost" | "subtle" | "danger";

const VARIANTS: Record<Variant, string> = {
  primary:
    "bg-accent text-white hover:bg-accent/88 active:bg-accent/80 disabled:bg-accent/35 disabled:text-white/60",
  ghost: "text-fg-muted hover:bg-hover hover:text-fg disabled:text-fg-subtle/50",
  subtle:
    "border border-line bg-elevated text-fg-muted hover:border-line-strong hover:text-fg disabled:text-fg-subtle/50",
  danger: "border border-danger/40 text-danger hover:bg-danger/10 hover:border-danger/70",
};

export type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant;
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "ghost", className, type = "button", ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      className={cn(
        "inline-flex h-7 shrink-0 items-center gap-1.5 rounded-[7px] px-2.5",
        "text-[12px] font-medium whitespace-nowrap",
        "transition-[background-color,color,border-color,transform] duration-120 ease-out",
        "active:scale-[0.97] disabled:pointer-events-none",
        VARIANTS[variant],
        className,
      )}
      {...props}
    />
  );
});
