import type { CSSProperties } from "react";
import { cx } from "./cx";

export interface SkeletonProps {
  width?: CSSProperties["width"];
  height?: CSSProperties["height"];
  className?: string;
}

/** A loading placeholder, hidden from screen readers: mark the loading region with aria-busy instead. */
export function Skeleton({ width, height, className }: SkeletonProps) {
  return <div aria-hidden="true" className={cx("tp-skeleton", className)} style={{ width, height }} />;
}
