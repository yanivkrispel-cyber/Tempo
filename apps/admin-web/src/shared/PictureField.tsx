import type { Schemas } from "@tempo/api-client";
import { useId, useRef, useState } from "react";
import { errorMessage } from "../api/errors";
import { useUploadPicture } from "../features/console/experience";
import { Banner, Button, Icon } from "./design-system";

const accepted = ["image/jpeg", "image/png", "image/webp"];
const maxBytes = 8 * 1024 * 1024;

/**
 * A picture for a class type, an instructor or the studio (docs/33 section 6): the current one, and a button that
 * uploads a new one at once. The server re-encodes it, so what shows after is what members see.
 */
export function PictureField({
  label,
  purpose,
  ownerId,
  url,
  shape = "wide",
}: {
  label: string;
  purpose: Schemas["MediaPurpose"];
  ownerId: string;
  url: string | null | undefined;
  shape?: "wide" | "round";
}) {
  const input = useRef<HTMLInputElement>(null);
  const labelId = useId();
  const upload = useUploadPicture();
  const [local, setLocal] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const shown = local ?? url ?? null;

  const choose = (file: File | undefined) => {
    if (!file) return;
    if (!accepted.includes(file.type)) return setProblem("אפשר להעלות תמונות JPEG, PNG או WebP.");
    if (file.size > maxBytes) return setProblem("התמונה גדולה מדי. אפשר עד 8 מגה.");
    setProblem(null);
    upload.mutate(
      { purpose, ownerId, file },
      {
        onSuccess: (media) => setLocal(media.smallUrl),
        onError: (error) => setProblem(errorMessage(error, "לא הצלחנו להעלות את התמונה. נסו שוב.")),
      },
    );
  };

  const round = shape === "round";
  return (
    <div className="tp-stack" style={{ gap: 8 }} role="group" aria-labelledby={labelId}>
      <span id={labelId} className="tp-label">
        {label}
      </span>
      <div className="tp-row" style={{ gap: 14, alignItems: "center" }}>
        <span
          style={{
            width: round ? 72 : 128,
            height: 72,
            borderRadius: round ? 999 : 16,
            overflow: "hidden",
            flex: "none",
            display: "grid",
            placeItems: "center",
            background: "var(--surface-sunken)",
            boxShadow: "var(--shadow-sunken)",
            color: "var(--ink-muted)",
          }}
        >
          {shown ? (
            <img src={shown} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
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
      {problem && (
        <Banner tone="danger" icon="info">
          {problem}
        </Banner>
      )}
    </div>
  );
}
