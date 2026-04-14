import { useEffect, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card.jsx";

export function MinutesWindow() {
  const [payload, setPayload] = useState({
    title: "\u4f1a\u8bae\u7eaa\u8981",
    minutes: "\u6682\u65e0\u4f1a\u8bae\u7eaa\u8981",
    startedAtLabel: "",
    endedAtLabel: "",
  });

  useEffect(() => {
    let disposed = false;
    let unsubscribe = () => {};

    async function bootstrap() {
      const current = await window.meetingDesktop.getMinutesPayload();
      if (!disposed && current) {
        setPayload(current);
        document.title = `${current.title || "\u4f1a\u8bae\u7eaa\u8981"} - \u91cf\u754c\u667a\u64ce\u4f1a\u8bae\u52a9\u624b`;
      }
      unsubscribe = window.meetingDesktop.onMinutesPayload((nextPayload) => {
        setPayload(nextPayload);
        document.title = `${nextPayload.title || "\u4f1a\u8bae\u7eaa\u8981"} - \u91cf\u754c\u667a\u64ce\u4f1a\u8bae\u52a9\u624b`;
      });
    }

    bootstrap();
    return () => {
      disposed = true;
      unsubscribe();
    };
  }, []);

  return (
    <main className="h-full overflow-hidden p-4">
      <div className="mx-auto flex h-full max-w-5xl flex-col gap-4">
        <Card>
          <CardHeader>
            <CardTitle>{payload.title || "\u4f1a\u8bae\u7eaa\u8981"}</CardTitle>
            <CardDescription>
              {[payload.startedAtLabel, payload.endedAtLabel ? `\u81f3 ${payload.endedAtLabel}` : ""]
                .filter(Boolean)
                .join("  ")}
            </CardDescription>
          </CardHeader>
        </Card>
        <Card className="min-h-0 flex-1">
          <CardContent className="h-full">
            <div className="panel-scroll h-full overflow-auto whitespace-pre-wrap rounded-xl border border-slate-800 bg-slate-950/80 p-4 text-sm leading-7 text-slate-200">
              {payload.minutes || "\u6682\u65e0\u4f1a\u8bae\u7eaa\u8981"}
            </div>
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
