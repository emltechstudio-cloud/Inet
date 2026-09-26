import { cn } from "@/lib/utils";

export function FlinkMark({ className, size = 40 }: { className?: string; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      className={cn("shrink-0", className)}
      aria-hidden
    >
      <path
        d="M7 23.5C7 14 12.2 8 16 8c3.8 0 9 6 9 15.5"
        stroke="currentColor"
        strokeWidth="2.4"
        strokeLinecap="round"
      />
      <path
        d="M11.5 20.5c1.6-3.8 3.1-5.5 4.5-5.5s2.9 1.7 4.5 5.5"
        stroke="currentColor"
        strokeWidth="2.4"
        strokeLinecap="round"
      />
      <circle cx="16" cy="8" r="1.6" fill="currentColor" />
    </svg>
  );
}

export function NumberAvatar({
  seed,
  label,
  size = 48,
}: {
  seed: string;
  label: string;
  size?: number;
}) {
  const tint = (() => {
    let h = 2166136261;
    for (let i = 0; i < seed.length; i++) {
      h ^= seed.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    const variants = ["#7B1535", "#9A1B44", "#5C0F28", "#8E2448", "#6A1230"];
    return variants[Math.abs(h) % variants.length]!;
  })();
  const text = label.replace(/\s/g, "").slice(0, 2).toUpperCase() || "FL";
  return (
    <div
      className="flex shrink-0 items-center justify-center rounded-full font-semibold text-primary-fg"
      style={{ width: size, height: size, background: tint, fontSize: size * 0.32 }}
    >
      {text}
    </div>
  );
}
