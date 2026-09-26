import { useEffect, useRef, useState } from "react";
import { ArrowLeft, ImagePlus, Phone, Send, Video } from "lucide-react";
import { Button } from "@/components/ui/button";
import { NumberAvatar } from "./mark";
import { useFlink } from "@/lib/flink/store";
import { formatFlinkNumber, formatTime } from "@/lib/utils";

export function ChatView() {
  const { activeThread, messages, contacts, sendText, sendImage, setView, approach, callStatus } = useFlink();
  const [draft, setDraft] = useState("");
  const bottom = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    bottom.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length]);

  if (!activeThread) {
    return (
      <div className="flex flex-1 items-center justify-center text-sm text-muted">Select a conversation</div>
    );
  }

  const peer = activeThread.peerNumber ?? activeThread.title;
  const name = contacts.find((c) => c.flinkNumber === peer)?.name || formatFlinkNumber(peer);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex items-center gap-2 border-b border-border bg-surface px-2 py-2">
        <Button variant="ghost" size="icon" onClick={() => setView("history")} aria-label="Back">
          <ArrowLeft className="size-5" />
        </Button>
        <NumberAvatar seed={peer} label={name} size={40} />
        <div className="min-w-0 flex-1">
          <p className="truncate font-semibold">{name}</p>
          <p className="text-xs text-muted">{callStatus || formatFlinkNumber(peer)}</p>
        </div>
        {/^\d{6}$/.test(peer) && (
          <>
            <Button variant="ghost" size="icon" onClick={() => void approach(peer, "voice")} aria-label="Voice">
              <Phone className="size-5" />
            </Button>
            <Button variant="ghost" size="icon" onClick={() => void approach(peer, "video")} aria-label="Video">
              <Video className="size-5" />
            </Button>
          </>
        )}
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-4">
        {messages.length === 0 && (
          <p className="px-6 py-12 text-center text-sm text-muted">
            Messages stay on this device. They travel peer to peer once you are connected.
          </p>
        )}
        {messages.map((m) => (
          <div key={m.id} className={`mb-2 flex ${m.mine ? "justify-end" : "justify-start"}`}>
            <div
              className={`max-w-[78%] rounded-[18px] px-3.5 py-2.5 text-[15px] leading-snug ${
                m.mine
                  ? "rounded-br-sm bg-primary text-primary-fg"
                  : "rounded-bl-sm border border-border bg-surface text-fg"
              }`}
            >
              {m.kind === "image" && m.imageUrl ? (
                <img src={m.imageUrl} alt="" className="mb-1 max-h-52 rounded-[12px]" />
              ) : null}
              {m.text}
              <div className={`mt-1 text-[10px] ${m.mine ? "text-primary-fg/70" : "text-subtle"}`}>
                {formatTime(m.ts)}
              </div>
            </div>
          </div>
        ))}
        <div ref={bottom} />
      </div>
      <form
        className="flex items-end gap-2 border-t border-border bg-surface px-3 py-2.5"
        onSubmit={(e) => {
          e.preventDefault();
          void sendText(draft);
          setDraft("");
        }}
      >
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void sendImage(f);
            e.target.value = "";
          }}
        />
        <Button type="button" variant="ghost" size="icon" onClick={() => fileRef.current?.click()} aria-label="Photo">
          <ImagePlus className="size-5" />
        </Button>
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          rows={1}
          placeholder="Write something temporary"
          className="max-h-28 min-h-11 flex-1 resize-none rounded-[20px] bg-bg px-4 py-2.5 text-[15px] text-fg outline-none"
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void sendText(draft);
              setDraft("");
            }
          }}
        />
        <Button type="submit" size="icon" className="rounded-full" disabled={!draft.trim()} aria-label="Send">
          <Send className="size-4" />
        </Button>
      </form>
    </div>
  );
}
