import { useEffect, useRef, useState } from "react";
import { ArrowLeft, ImagePlus, Mic, Phone, Send, Smile, Video, RefreshCw, Users, FileAudio, Film, Gift } from "lucide-react";
import { Button } from "@/components/ui/button";
import { NumberAvatar } from "./mark";
import { useFlink } from "@/lib/flink/store";
import { formatFlinkNumber, formatTime } from "@/lib/utils";
import type { ChatMessage } from "@/lib/flink/types";

export function ChatView() {
  const {
    activeThread,
    messages,
    contacts,
    sendText,
    sendImage,
    sendVoiceNote,
    sendVideo,
    sendGif,
    addReaction,
    setView,
    approach,
    callStatus,
    peerStatuses,
    sessionEnded,
    startNewSession,
  } = useFlink();
  const [draft, setDraft] = useState("");
  const [fileMenuOpen, setFileMenuOpen] = useState(false);
  const [emojiPickerOpen, setEmojiPickerOpen] = useState(false);
  const [selectedMessageId, setSelectedMessageId] = useState<string | null>(null);
  const [recordingVoice, setRecordingVoice] = useState(false);
  const bottom = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const voiceRef = useRef<HTMLInputElement>(null);
  const videoRef = useRef<HTMLInputElement>(null);
  const gifRef = useRef<HTMLInputElement>(null);
  const voiceRecorderRef = useRef<MediaRecorder | null>(null);
  const voiceChunksRef = useRef<Blob[]>([]);

  useEffect(() => {
    bottom.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length]);

  useEffect(() => {
    if (sessionEnded && activeThread) {
      bottom.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [sessionEnded, activeThread]);

  async function toggleVoiceRecording() {
    if (recordingVoice) {
      voiceRecorderRef.current?.stop();
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      voiceRef.current?.click();
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      voiceChunksRef.current = [];
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) voiceChunksRef.current.push(event.data);
      };
      recorder.onstop = () => {
        const blob = new Blob(voiceChunksRef.current, { type: recorder.mimeType || "audio/webm" });
        stream.getTracks().forEach((track) => track.stop());
        voiceRecorderRef.current = null;
        setRecordingVoice(false);
        if (blob.size > 0) void sendVoiceNote(new File([blob], `voice-${Date.now()}.webm`, { type: blob.type }));
      };
      voiceRecorderRef.current = recorder;
      recorder.start();
      setRecordingVoice(true);
    } catch {
      setRecordingVoice(false);
    }
  }

  if (!activeThread) {
    return (
      <div className="flex flex-1 items-center justify-center text-sm text-muted">Select a conversation</div>
    );
  }

  const peer = activeThread.peerNumber ?? activeThread.title;
  const name = contacts.find((c) => c.flinkNumber === peer)?.name || formatFlinkNumber(peer);

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-[#efeae2]">
      <header className="flex items-center gap-1 bg-[#075e54] px-1 py-2 text-white shadow-sm">
        <Button variant="ghost" size="icon" className="text-white hover:bg-white/10" onClick={() => setView("history")} aria-label="Back">
          <ArrowLeft className="size-5" />
        </Button>
        <NumberAvatar seed={peer} label={name} size={40} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-[15px] font-semibold">{name}</p>
          <p className="text-xs text-white/75">
            {(() => {
              const status = peerStatuses.get(peer);
              if (status?.online) return "Online";
              if (status?.lastSeen) return `Last seen: ${formatTime(status.lastSeen)}`;
              return callStatus || formatFlinkNumber(peer);
            })()}
          </p>
        </div>
        {/^\d{6}$/.test(peer) && (
          <>
            <Button variant="ghost" size="icon" className="text-white hover:bg-white/10" onClick={() => void approach(peer, "voice")} aria-label="Voice call">
              <Phone className="size-5" />
            </Button>
            <Button variant="ghost" size="icon" className="text-white hover:bg-white/10" onClick={() => void approach(peer, "video")} aria-label="Video call">
              <Video className="size-5" />
            </Button>
          </>
        )}
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto bg-[radial-gradient(rgba(117,96,78,0.08)_1px,transparent_1px)] [background-size:18px_18px] px-3 py-4">
        {messages.length === 0 && (
          <div className="mx-auto mt-8 max-w-[280px] rounded-lg bg-[#fff5c4] px-4 py-2.5 text-center text-xs leading-relaxed text-[#6b5c32] shadow-sm">
            Messages stay on this device. They travel peer to peer once you are connected.
          </div>
        )}
        {messages.map((m) => (
          <div key={m.id} className={`mb-2 flex ${m.mine ? "justify-end" : "justify-start"}`}>
            <div
              className={`relative max-w-[86%] rounded-[9px] px-3 py-2 text-[15px] leading-snug shadow-[0_1px_1px_rgba(0,0,0,0.12)] ${
                m.mine
                  ? "rounded-br-[2px] bg-[#d9fdd3] text-[#111b21]"
                  : "rounded-bl-[2px] bg-white text-[#111b21]"
              }`}
              onContextMenu={(e) => {
                e.preventDefault();
                if (!m.mine) {
                  setSelectedMessageId(m.id);
                  setEmojiPickerOpen(true);
                }
              }}
            >
              {m.kind === "image" && m.imageUrl ? (
                <img src={m.imageUrl} alt="Photo message" className="mb-1 max-h-64 rounded-[7px]" />
              ) : null}
              {m.kind === "voice" && m.audioUrl ? (
                <audio src={m.audioUrl} controls className="mb-1 w-full" />
              ) : null}
              {m.kind === "video" && m.videoUrl ? (
                <video src={m.videoUrl} controls className="mb-1 max-h-64 w-full rounded-[7px]" />
              ) : null}
              {m.kind === "gif" && m.imageUrl ? (
                <img src={m.imageUrl} alt="GIF" className="mb-1 max-h-64 rounded-[7px]" />
              ) : null}
              {m.kind === "text" && m.text}
              {m.reactions && Object.keys(m.reactions).length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1">
                  {Object.entries(m.reactions).map(([emoji, reaction]) => (
                    <span
                      key={emoji}
                      className="flex items-center gap-1 rounded-full bg-bg/50 px-2 py-1 text-xs"
                    >
                      <span>{emoji}</span>
                      <span className="text-subtle">{reaction.count}</span>
                    </span>
                  ))}
                </div>
              )}
              <div className={`mt-1 flex items-center justify-end gap-1 text-[10px] ${m.mine ? "text-[#667b65]" : "text-[#667781]"}`}>
                <span>{formatTime(m.ts)}</span>
                <span>
                  {m.mine && m.status === "sent" && "✓"}
                  {m.mine && m.status === "delivered" && "✓✓"}
                  {m.mine && m.status === "read" && <span className="text-[#53bdeb]">✓✓</span>}
                  {!m.mine && m.status === "read" && <span className="text-[#53bdeb]">✓✓</span>}
                </span>
              </div>
            </div>
          </div>
        ))}
        <div ref={bottom} />
      </div>
      {sessionEnded && activeThread && (
        <div className="border-t border-border bg-surface px-4 py-3 text-center">
          <p className="text-sm text-muted">Session has ended</p>
          <Button
            className="mt-2"
            onClick={() => void startNewSession(peer)}
          >
            <RefreshCw className="mr-2 size-4" />
            Start New Session
          </Button>
        </div>
      )}
      <form
        className="flex items-end gap-2 border-t border-[#d6d1cb] bg-[#f0f2f5] px-2 py-2"
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
        <input
          ref={voiceRef}
          type="file"
          accept="audio/*"
          capture
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void sendVoiceNote(f);
            e.target.value = "";
          }}
        />
        <input
          ref={videoRef}
          type="file"
          accept="video/*"
          capture
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void sendVideo(f);
            e.target.value = "";
          }}
        />
        <input
          ref={gifRef}
          type="file"
          accept="image/gif"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void sendGif(f);
            e.target.value = "";
          }}
        />
        <div className="relative flex items-center gap-1">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-10 rounded-full text-[#54656f] hover:bg-[#e2e6e8]"
            onClick={() => setFileMenuOpen(!fileMenuOpen)}
            aria-label="Attach"
          >
            <ImagePlus className="size-5" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-9 rounded-full px-2 font-bold text-[11px] text-[#54656f] hover:bg-[#e2e6e8]"
            onClick={() => gifRef.current?.click()}
            aria-label="Send GIF"
          >
            GIF
          </Button>
        {fileMenuOpen && (
            <div className="absolute bottom-12 left-0 z-10 rounded-[16px] border border-border bg-surface p-2 shadow-lg">
              <button
                type="button"
                className="flex items-center gap-2 w-full rounded-[12px] px-3 py-2 text-left text-sm hover:bg-bg"
                onClick={() => {
                  fileRef.current?.click();
                  setFileMenuOpen(false);
                }}
              >
                <ImagePlus className="size-4" />
                Photo
              </button>
              <button
                type="button"
                className="flex items-center gap-2 w-full rounded-[12px] px-3 py-2 text-left text-sm hover:bg-bg"
                onClick={() => {
                  void toggleVoiceRecording();
                  setFileMenuOpen(false);
                }}
              >
                <Mic className="size-4" />
                {recordingVoice ? "Stop recording" : "Record voice note"}
              </button>
              <button
                type="button"
                className="flex items-center gap-2 w-full rounded-[12px] px-3 py-2 text-left text-sm hover:bg-bg"
                onClick={() => {
                  voiceRef.current?.click();
                  setFileMenuOpen(false);
                }}
              >
                <FileAudio className="size-4" />
                Choose audio file
              </button>
              <button
                type="button"
                className="flex items-center gap-2 w-full rounded-[12px] px-3 py-2 text-left text-sm hover:bg-bg"
                onClick={() => {
                  videoRef.current?.click();
                  setFileMenuOpen(false);
                }}
              >
                <Film className="size-4" />
                Video
              </button>
              <button
                type="button"
                className="flex items-center gap-2 w-full rounded-[12px] px-3 py-2 text-left text-sm hover:bg-bg"
                onClick={() => {
                  gifRef.current?.click();
                  setFileMenuOpen(false);
                }}
              >
                <Gift className="size-4" />
                GIF
              </button>
            </div>
          )}
        </div>
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          rows={1}
          placeholder={recordingVoice ? "Recording voice note… tap the mic to stop" : "Type a message"}
          className="max-h-28 min-h-10 flex-1 resize-none rounded-[22px] border border-[#d5dadd] bg-white px-4 py-2.5 text-[15px] text-[#111b21] outline-none placeholder:text-[#667781] focus:border-[#075e54]"
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void sendText(draft);
              setDraft("");
            }
          }}
        />
        <Button
          type={draft.trim() ? "submit" : "button"}
          size="icon"
          className={`size-10 rounded-full ${recordingVoice ? "bg-danger" : "bg-[#075e54] hover:bg-[#128c7e]"}`}
          onClick={!draft.trim() ? () => void toggleVoiceRecording() : undefined}
          aria-label={draft.trim() ? "Send message" : recordingVoice ? "Stop recording" : "Record voice note"}
        >
          {draft.trim() ? <Send className="size-4" /> : <Mic className="size-4" />}
        </Button>
      </form>
      {emojiPickerOpen && selectedMessageId && (
        <div className="fixed bottom-20 left-1/2 -translate-x-1/2 z-50 rounded-[20px] border border-border bg-surface p-4 shadow-lg">
          <p className="mb-2 text-sm">React with emoji</p>
          <div className="grid grid-cols-6 gap-2">
            {["👍", "❤️", "🔥", "😂", "😢", "👏", "✨", "💯", "🎉", "🙏", "🚀", "💖"].map((emoji) => (
              <button
                key={emoji}
                type="button"
                className="text-2xl hover:bg-bg rounded-full p-1"
                onClick={() => {
                  void addReaction(selectedMessageId, emoji);
                  setEmojiPickerOpen(false);
                  setSelectedMessageId(null);
                }}
              >
                {emoji}
              </button>
            ))}
          </div>
          <Button
            variant="ghost"
            size="sm"
            className="mt-2 w-full"
            onClick={() => {
              setEmojiPickerOpen(false);
              setSelectedMessageId(null);
            }}
          >
            Cancel
          </Button>
        </div>
      )}
    </div>
  );
}
