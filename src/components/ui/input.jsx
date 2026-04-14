import { cn } from "@/lib/utils.js";

export function Input({ className, type = "text", ...props }) {
  return (
    <input
      type={type}
      className={cn(
        "flex h-10 w-full rounded-md border border-slate-800 bg-slate-950/80 px-3 py-2 text-sm text-slate-100 shadow-sm outline-none transition-colors placeholder:text-slate-500 focus-visible:border-sky-500 focus-visible:ring-2 focus-visible:ring-sky-400/20",
        className
      )}
      {...props}
    />
  );
}
