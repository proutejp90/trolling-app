import type { ButtonHTMLAttributes } from "react";

const variants = {
  primary: "bg-accent text-accent-on shadow-sm hover:bg-accent-hover",
  secondary: "border-border bg-surface-3 text-fg hover:border-border-strong hover:bg-surface-4",
  ghost: "text-fg-secondary hover:bg-surface-3 hover:text-fg",
  danger: "bg-danger-soft text-danger",
} as const;

// sm, md, lg are Meridian's desktop sizes. touch and touch-lg are the on-water
// profile for angler screens (44px, and 56px for Fish on and Probe).
const sizes = {
  sm: "h-ctl-sm px-2 text-small",
  md: "h-ctl px-3 text-ui",
  lg: "h-ctl-lg px-4 text-ui",
  touch: "h-touch px-4 text-body font-medium",
  "touch-lg": "h-touch-lg px-5 text-t3",
} as const;

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: keyof typeof variants;
  size?: keyof typeof sizes;
}

export function Button({ variant = "secondary", size = "md", className = "", type = "button", ...props }: ButtonProps) {
  return (
    <button
      type={type}
      className={`inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-sm border border-transparent transition-colors duration-100 disabled:cursor-not-allowed disabled:border-border-subtle disabled:bg-surface-1 disabled:text-fg-disabled disabled:shadow-none ${variants[variant]} ${sizes[size]} ${className}`}
      {...props}
    />
  );
}
