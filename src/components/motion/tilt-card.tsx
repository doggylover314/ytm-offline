import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export interface TiltCardProps {
  children: ReactNode;
  /** No-op; kept so existing callers compile. */
  max?: number;
  /** No-op; kept so existing callers compile. */
  glare?: boolean;
  className?: string;
}

/** A plain artwork container. It used to tilt toward the cursor; the design has no such effect. */
export function TiltCard({ children, className }: TiltCardProps) {
  return <div className={cn("relative overflow-hidden rounded-[6px]", className)}>{children}</div>;
}
