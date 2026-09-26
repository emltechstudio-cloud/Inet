import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap font-semibold transition-[transform,background-color,box-shadow,color,border-color] duration-150 ease-[cubic-bezier(0.22,1,0.36,1)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/35 disabled:pointer-events-none disabled:opacity-50 active:scale-[0.98]",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-fg hover:bg-primary-2 shadow-[0_2px_16px_rgba(123,21,53,0.18)]",
        secondary:
          "bg-surface text-fg border border-border hover:border-primary hover:text-primary hover:bg-mist",
        ghost: "text-fg hover:bg-mist",
        danger: "bg-danger text-primary-fg hover:opacity-90",
        outline: "border border-border bg-transparent hover:bg-mist",
      },
      size: {
        default: "h-12 px-5 rounded-[12px] text-sm",
        sm: "h-9 px-3 rounded-[10px] text-xs",
        lg: "h-14 px-6 rounded-[14px] text-base",
        icon: "size-11 rounded-[12px]",
        round: "size-14 rounded-full",
      },
    },
    defaultVariants: { variant: "default", size: "default" },
  },
);

export function Button({
  className,
  variant,
  size,
  asChild = false,
  ...props
}: React.ComponentProps<"button"> & VariantProps<typeof buttonVariants> & { asChild?: boolean }) {
  const Comp = asChild ? Slot : "button";
  return <Comp className={cn(buttonVariants({ variant, size }), className)} {...props} />;
}

export { buttonVariants };
