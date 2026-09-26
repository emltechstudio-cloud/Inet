import { useState } from "react";
import { MessageCircle, Phone, Plus, Radio, Video } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NumberAvatar } from "./mark";
import { useFlink } from "@/lib/flink/store";
import { formatFlinkNumber } from "@/lib/utils";
import type { CommMode, FlinkGroup } from "@/lib/flink/types";

export function GroupsView() {
  const { groups, createGroup, approachGroup, refreshGroups } = useFlink();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [members, setMembers] = useState("");

  async function submit() {
    if (!name.trim()) return;
    const nums = members
      .split(/[,\s]+/)
      .map((s) => s.replace(/\D/g, ""))
      .filter((s) => s.length === 6);
    await createGroup(name.trim(), nums);
    setName("");
    setMembers("");
    setOpen(false);
    void refreshGroups();
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center justify-between px-5 pt-4 pb-2">
        <div>
          <p className="text-xs font-semibold tracking-[0.14em] text-muted uppercase">Groups</p>
          <p className="mt-1 text-sm text-muted">Names and members only. Talk still happens between devices.</p>
        </div>
        <Button size="icon" onClick={() => setOpen((v) => !v)} aria-label="New group">
          <Plus className="size-5" />
        </Button>
      </div>
      {open && (
        <div className="mx-4 mb-3 rounded-[24px] border border-border bg-surface p-4">
          <Label htmlFor="gname">Name</Label>
          <Input id="gname" value={name} onChange={(e) => setName(e.target.value)} className="mb-3" />
          <Label htmlFor="gmembers">Member numbers</Label>
          <Input
            id="gmembers"
            placeholder="482910 193847"
            value={members}
            onChange={(e) => setMembers(e.target.value)}
            className="mb-3"
          />
          <Button className="w-full" onClick={() => void submit()}>
            Create group
          </Button>
        </div>
      )}
      <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-4">
        {groups.length === 0 && (
          <p className="px-4 py-12 text-center text-sm text-muted">No groups yet. Create one from numbers you already know.</p>
        )}
        {groups.map((g) => (
          <GroupRow key={g.group_id} group={g} onApproach={(mode) => void approachGroup(g, mode)} />
        ))}
      </div>
    </div>
  );
}

function GroupRow({ group, onApproach }: { group: FlinkGroup; onApproach: (mode: CommMode) => void }) {
  return (
    <div className="mb-2 rounded-[20px] border border-border bg-surface p-4">
      <div className="flex items-center gap-3">
        <NumberAvatar seed={group.group_id} label={group.name} />
        <div className="min-w-0 flex-1">
          <p className="font-semibold">{group.name}</p>
          <p className="truncate text-sm text-muted">
            {group.members.map((m) => formatFlinkNumber(m)).join(" · ")}
          </p>
        </div>
      </div>
      <div className="mt-3 flex gap-2">
        <Button size="sm" variant="secondary" onClick={() => onApproach("ping")}>
          <Radio className="size-3.5" /> Ping
        </Button>
        <Button size="sm" variant="secondary" onClick={() => onApproach("chat")}>
          <MessageCircle className="size-3.5" /> Chat
        </Button>
        <Button size="sm" variant="secondary" onClick={() => onApproach("voice")}>
          <Phone className="size-3.5" /> Voice
        </Button>
        <Button size="sm" variant="secondary" onClick={() => onApproach("video")}>
          <Video className="size-3.5" /> Video
        </Button>
      </div>
    </div>
  );
}
