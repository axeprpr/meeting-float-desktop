import { cva } from "class-variance-authority";
import { cn } from "@/lib/utils.js";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-all disabled:pointer-events-none disabled:opacity-50 outline-none focus-visible:ring-2 focus-visible:ring-sky-400/60",
  {
    variants: {
      variant: {
        default: "bg-slate-50 text-slate-900 hover:bg-slate-200",
        secondary: "bg-slate-800 text-slate-100 hover:bg-slate-700",
        outline: "border border-slate-700 bg-transparent text-slate-100 hover:bg-slate-900/70",
        ghost: "text-slate-200 hover:bg-slate-900/70",
        destructive: "bg-rose-500 text-white hover:bg-rose-400",
      },
      size: {
        default: "h-10 px-4 py-2",
        sm: "h-9 rounded-md px-3",
        lg: "h-11 rounded-md px-8",
        icon: "h-10 w-10",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
);

export function Button({ className, variant, size, asChild = false, ...props }) {
  const Comp = asChild ? "span" : "button";
  return <Comp className={cn(buttonVariants({ variant, size, className }))} {...props} />;
}

export { buttonVariants };
