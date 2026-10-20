import type { Schemas } from "@tempo/api-client";
import { useId, useRef, useState } from "react";
import { errorMessage } from "../api/errors";
import { useRemovePicture, useUploadPicture } from "../features/console/experience";
import { Banner, Button, Icon } from "./design-system";

const accepted = ["image/jpeg", "image/png", "image/webp"];
const maxBytes = 8 * 1024 * 1024;

/**
 * A picture for a class type, an instructor or the studio (docs/33 section 6): the current one, and a button that
 * uploads a new one at once. The server re-encodes it, so what shows after is what members see. With `removeLabel`
 * it can also be taken away (the studio's logo and icon, docs/35 section 2).
 */
export function PictureField({
  label,
  purpose,
  ownerId,
  url,
  shape = "wide",
  fit = "cover",
  hint,
  removeLabel,
  onUploaded,
}: {
  label: string;
  purpose: Schemas["MediaPurpose"];
  ownerId: string;
  url: string | null | undefined;
  shape?: "wide" | "round" | "square";
  /** `contain` shows the whole picture, for a logo that must not be cropped. */
  fit?: "cover" | "contain";
  hint?: string;
  removeLabel?: string;
  onUploaded?: (media: Schemas["Media"]) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const labelId = useId();
  const upload = useUploadPicture();
  const remove = useRemovePicture();
  const [local, setLocal] = useState<string | null>(null);
  // Hides the old picture at once, before the refetch says it is gone.
  const [removed, setRemoved] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const shown = local ?? (removed ? null : url) ?? null;

  const choose = (file: File | undefined) => {
    if (!file) return;
    if (!accepted.includes(file.type)) return setProblem("אפשר להעלות תמונות JPEG, PNG או WebP.");
    if (file.size > maxBytes) return setProblem("התמונה גדולה מדי. אפשר עד 8 מגה.");
    setProblem(null);
    upload.mutate(
      { purpose, ownerId, file },
      {
        onSuccess: (media) => {
          setLocal(media.smallUrl);
          setRemoved(false);
          onUploaded?.(media);
        },
        onError: (error) => setProblem(errorMessage(error, "לא הצלחנו להעלות את התמונה. נסו שוב.")),
      },
    );
  };

  const take = () => {
    setProblem(null);
    remove.mutate(
      { purpose, ownerId },
      {
        onSuccess: () => {
          setLocal(null);
          setRemoved(true);
        },
        onError: (error) => setProblem(errorMessage(error, "לא הצלחנו להסיר את התמונה. נסו שוב.")),
      },
    );
  };

  const round = shape === "round";
  const narrow = shape !== "wide";
  return (
    <div className="tp-stack" style={{ gap: 8 }} role="group" aria-labelledby={labelId}>
      <span id={labelId} className="tp-label">
        {label}
      </span>
      <div className="tp-row" style={{ gap: 14, alignItems: "center", flexWrap: "wrap" }}>
        <span
          style={{
            width: narrow ? 72 : 128,
            height: 72,
            borderRadius: round ? 999 : 16,
            overflow: "hidden",
            position: "relative",
            flex: "none",
            display: "grid",
            placeItems: "center",
            background: "var(--surface-sunken)",
            boxShadow: "var(--shadow-sunken)",
            color: "var(--ink-muted)",
          }}
        >
          {shown ? (
            <img
              src={shown}
              alt=""
              style={{
                position: "absolute",
                inset: 0,
                width: "100%",
                height: "100%",
                boxSizing: "border-box",
                objectFit: fit,
                padding: fit === "contain" ? 6 : 0,
              }}
            />
          ) : (
            <Icon name="image" />
          )}
        </span>
        <Button
          variant="secondary"
          size="sm"
          icon="image"
          loading={upload.isPending}
          onClick={() => input.current?.click()}
        >
          {shown ? "החלפת תמונה" : "העלאת תמונה"}
        </Button>
        {removeLabel && shown && (
          <Button variant="ghost" size="sm" icon="close" loading={remove.isPending} onClick={take}>
            {removeLabel}
          </Button>
        )}
        <input
          ref={input}
          type="file"
          accept={accepted.join(",")}
          hidden
          onChange={(event) => {
            choose(event.target.files?.[0]);
            event.target.value = "";
          }}
        />
      </div>
      {hint && !problem && <span className="tp-caption">{hint}</span>}
      {problem && (
        <Banner tone="danger" icon="info">
          {problem}
        </Banner>
      )}
    </div>
  );
}
