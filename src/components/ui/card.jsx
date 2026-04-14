import { cn } from "@/lib/utils.js";

export function Card({ className, ...props }) {
  return (
    <div
      className={cn(
        "rounded-xl border border-slate-800/80 bg-slate-950/60 text-slate-50 shadow-[0_24px_80px_-32px_rgba(15,23,42,0.9)] backdrop-blur",
        className
      )}
      {...props}
    />
  );
}

export function CardHeader({ className, ...props }) {
  return <div className={cn("flex flex-col space-y-1.5 p-6", className)} {...props} />;
}

export function CardTitle({ className, ...props }) {
  return <div className={cn("text-lg font-semibold leading-none tracking-tight", className)} {...props} />;
}

export function CardDescription({ className, ...props }) {
  return <div className={cn("text-sm text-slate-400", className)} {...props} />;
}

export function CardContent({ className, ...props }) {
  return <div className={cn("p-6 pt-0", className)} {...props} />;
}
