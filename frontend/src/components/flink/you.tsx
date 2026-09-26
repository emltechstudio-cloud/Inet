import { Bell, Download, LogOut, Smartphone } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { FlinkMark } from "./mark";
import { useFlink } from "@/lib/flink/store";
import { formatFlinkNumber } from "@/lib/utils";
import { installApp } from "@/pwa";
import { registerFlinkPush } from "@/lib/flink/push";

export function YouView() {
  const { profile, downloadSim, logout } = useFlink();
  if (!profile) return null;
  const token = profile.accessToken;
  async function enableNotifications() {
    const enabled = await registerFlinkPush(token, true);
    if (enabled) toast.success("Flink notifications are enabled");
    else toast.error("Notifications could not be enabled on this browser");
  }
  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-5 py-6">
      <div className="flex flex-col items-center text-center">
        <div className="mb-4 flex size-16 items-center justify-center rounded-[20px] bg-primary text-primary-fg">
          <FlinkMark size={32} />
        </div>
        <p className="text-xs font-semibold tracking-[0.14em] text-muted uppercase">Your number</p>
        <p className="font-display mt-2 text-5xl tracking-[0.12em] text-primary tabular-nums">
          {formatFlinkNumber(profile.flinkNumber)}
        </p>
        <p className="mt-3 max-w-xs text-sm text-muted">
          People approach this number. There is no public profile, no feed, and no online lamp.
        </p>
      </div>
      <div className="mt-8 space-y-2">
        <Button className="w-full" onClick={downloadSim}>
          <Download className="size-4" />
          Download Flink SIM
        </Button>
        <Button variant="secondary" className="w-full" onClick={() => void installApp()}>
          <Smartphone className="size-4" />
          Install Flink on this device
        </Button>
        <Button variant="secondary" className="w-full" onClick={() => void enableNotifications()}>
          <Bell className="size-4" />
          Enable notifications
        </Button>
        <Button
          variant="secondary"
          className="w-full"
          onClick={() => {
            if (window.confirm("Leave this device? Local conversations stay until you clear the browser.")) {
              void logout();
            }
          }}
        >
          <LogOut className="size-4" />
          Leave this device
        </Button>
      </div>
      <p className="mt-8 text-center text-xs leading-relaxed text-subtle">
        Conversations live on this device. The Flink service only holds your number, groups, and the handshake that
        starts a call.
      </p>
    </div>
  );
}
