import { Phone, Radio, Video } from "lucide-react";
import { NumberAvatar } from "./mark";
import { useFlink } from "@/lib/flink/store";
import { formatFlinkNumber, formatTime } from "@/lib/utils";

export function HistoryView() {
  const { threads, calls, contacts, openThread, approach } = useFlink();
  const nameOf = (n: string) => contacts.find((c) => c.flinkNumber === n)?.name || formatFlinkNumber(n);

  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-4">
      <section className="pt-2">
        <p className="px-3 py-2 text-[11px] font-semibold tracking-[0.12em] text-muted uppercase">Conversations</p>
        {threads.length === 0 && (
          <p className="px-3 py-8 text-center text-sm text-muted">Nothing yet. Approach a number to begin.</p>
        )}
        {threads.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => void openThread(t)}
            className="flex w-full items-center gap-3 rounded-[16px] px-3 py-3 text-left hover:bg-mist"
          >
            <NumberAvatar seed={t.peerNumber || t.id} label={t.title} />
            <div className="min-w-0 flex-1">
              <div className="flex items-baseline justify-between gap-2">
                <p className="truncate font-semibold">{t.kind === "direct" ? nameOf(t.peerNumber ?? t.title) : t.title}</p>
                <span className="text-[11px] text-subtle tabular-nums">{formatTime(t.lastTs)}</span>
              </div>
              <p className="truncate text-sm text-muted">{t.lastText}</p>
            </div>
          </button>
        ))}
      </section>
      <section className="pt-4">
        <p className="px-3 py-2 text-[11px] font-semibold tracking-[0.12em] text-muted uppercase">Approaches</p>
        {calls.length === 0 && <p className="px-3 py-6 text-center text-sm text-muted">No pings or calls stored here.</p>}
        {calls.slice(0, 20).map((c) => {
          const Icon = c.mode === "video" ? Video : c.mode === "voice" ? Phone : Radio;
          return (
            <button
              key={c.id}
              type="button"
              onClick={() => void approach(c.peer, c.mode)}
              className="flex w-full items-center gap-3 rounded-[16px] px-3 py-3 text-left hover:bg-mist"
            >
              <div className="flex size-11 items-center justify-center rounded-full bg-mist text-primary">
                <Icon className="size-4" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="font-semibold">{nameOf(c.peer)}</p>
                <p className="text-sm text-muted">
                  {c.direction === "out" ? "You approached" : "They approached"} · {c.mode} · {c.status}
                </p>
              </div>
              <span className="text-[11px] text-subtle tabular-nums">{formatTime(c.ts)}</span>
            </button>
          );
        })}
      </section>
    </div>
  );
}
