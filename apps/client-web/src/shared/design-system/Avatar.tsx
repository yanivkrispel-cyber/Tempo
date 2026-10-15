import { cx } from "./cx";

export interface AvatarProps {
  /** The person's name: the accessible name, and the initials when there is no photo. */
  name: string;
  src?: string;
  size?: "sm" | "md" | "lg";
  tone?: "sand" | "brand" | "taupe";
  className?: string;
}

/** The first letter of the first two words: "נגה לוי" → "נל". */
export function initials(name: string): string {
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((word) => Array.from(word)[0] ?? "")
    .join("");
}

export function Avatar({ name, src, size = "md", tone = "sand", className }: AvatarProps) {
  return (
    <span
      role="img"
      aria-label={name}
      className={cx(
        "tp-avatar",
        size !== "md" && `tp-avatar--${size}`,
        tone !== "sand" && `tp-avatar--${tone}`,
        className,
      )}
    >
      {src ? <img src={src} alt="" /> : initials(name)}
    </span>
  );
}
