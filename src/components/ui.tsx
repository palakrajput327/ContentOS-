import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import { Slot } from "@radix-ui/react-slot";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { cva } from "class-variance-authority";
import { clsx } from "clsx";
import { twMerge } from "tailwind-merge";
import {
  X,
  ArrowUpRight,
  Linkedin,
  Instagram,
  Facebook,
  Youtube,
  Send,
} from "lucide-react";
import { statusLabel, type Platform } from "../lib/model";
export const cn = (...v: Parameters<typeof clsx>) => twMerge(clsx(v));
const variants = cva("btn", {
  variants: {
    variant: {
      primary: "btn-primary",
      secondary: "btn-secondary",
      ghost: "btn-ghost",
      danger: "btn-danger",
    },
  },
  defaultVariants: { variant: "secondary" },
});
export const Button = forwardRef<
  HTMLButtonElement,
  ButtonHTMLAttributes<HTMLButtonElement> & {
    asChild?: boolean;
    variant?: "primary" | "secondary" | "ghost" | "danger";
  }
>(({ asChild, variant, className, ...props }, ref) => {
  const Comp = asChild ? Slot : "button";
  return (
    <Comp
      ref={ref}
      className={cn(variants({ variant }), className)}
      {...props}
    />
  );
});
export function Logo() {
  return (
    <span className="brandmark">
      <span className="brand-icon">
        C<span />
      </span>
      Content<span className="brand-os">OS</span>
    </span>
  );
}
export function PlatformIcon({ platform }: { platform: Platform }) {
  const Icon =
    platform === "LinkedIn"
      ? Linkedin
      : platform === "Facebook" ? Facebook : platform === "Instagram"
        ? Instagram
        : platform === "YouTube"
          ? Youtube
          : platform === "Telegram"
            ? Send
            : null;
  return (
    <span
      className={`platform platform-${platform.toLowerCase()}`}
      title={platform}
    >
      {Icon ? <Icon size={15} /> : <span>𝕏</span>}
    </span>
  );
}
export function StatusBadge({ status }: { status: string }) {
  return (
    <span className={`badge status-${status.toLowerCase()}`}>
      {statusLabel(status)}
    </span>
  );
}
export function Empty({
  icon,
  title,
  children,
}: {
  icon?: ReactNode;
  title: string;
  children?: ReactNode;
}) {
  return (
    <div className="empty">
      {icon}
      <h3>{title}</h3>
      {children}
    </div>
  );
}
export function Modal({
  open,
  onOpenChange,
  title,
  description,
  children,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="dialog-overlay" />
        <DialogPrimitive.Content className="dialog-content">
          <DialogPrimitive.Title>{title}</DialogPrimitive.Title>
          <DialogPrimitive.Description>
            {description || "Review the details below."}
          </DialogPrimitive.Description>
          <DialogPrimitive.Close className="dialog-close" aria-label="Close">
            <X size={20} />
          </DialogPrimitive.Close>
          {children}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
export function SectionLink({ children }: { children: ReactNode }) {
  return (
    <span className="section-link">
      {children}
      <ArrowUpRight size={15} />
    </span>
  );
}
