import * as TabsPrimitive from "@radix-ui/react-tabs";
import { cn } from "@/lib/utils.js";

export function Tabs(props) {
  return <TabsPrimitive.Root {...props} />;
}

export function TabsList({ className, ...props }) {
  return (
    <TabsPrimitive.List
      className={cn("inline-flex h-10 items-center rounded-md bg-slate-900 p-1 text-slate-400", className)}
      {...props}
    />
  );
}

export function TabsTrigger({ className, ...props }) {
  return (
    <TabsPrimitive.Trigger
      className={cn(
        "inline-flex items-center justify-center whitespace-nowrap rounded-sm px-3 py-1.5 text-sm font-medium transition-all data-[state=active]:bg-slate-800 data-[state=active]:text-slate-50",
        className
      )}
      {...props}
    />
  );
}

export function TabsContent({ className, ...props }) {
  return <TabsPrimitive.Content className={cn("mt-4 outline-none", className)} {...props} />;
}
