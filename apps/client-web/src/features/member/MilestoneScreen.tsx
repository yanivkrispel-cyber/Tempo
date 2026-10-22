import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router";
import { Button, ButtonLink, EmptyState, IconButton, useToast } from "../../shared/design-system";
import { saveFile } from "../../shared/utilities/saveFile";
import {
  CARD_HEIGHT,
  CARD_WIDTH,
  drawMilestone,
  loadCardFonts,
  milestoneFile,
  type MilestoneCardInput,
} from "./drawMilestone";
import styles from "./member.module.css";
import { isMilestone, milestoneLine, milestoneStats, useMilestones, type Milestone } from "./milestones";
import { useStudio, useStudioClock, type Studio } from "./studio";
import { ListSkeleton, LoadError, NoStudio } from "./StudioGate";

const title = "אבן דרך";

/**
 * "השיעור החמישים שלי" (docs/37 section 8.2, MK8): the card for a milestone she reached, opened from the inbox. Hers
 * only (M-16): the route sits behind her sign-in, the numbers come from her own `me/milestones`, and the picture is
 * drawn on her device and leaves it only through her own share.
 */
export function MilestoneScreen() {
  const studio = useStudio();
  return studio ? <StudioMilestone studio={studio} /> : <NoStudio title={title} />;
}

function StudioMilestone({ studio }: { studio: Studio }) {
  const navigate = useNavigate();
  const count = Number(useParams().count);
  const milestones = useMilestones(studio.id);
  const { timeZone } = useStudioClock(studio.id);
  const reached = isMilestone(count) && (milestones.data?.reached ?? []).includes(count);

  return (
    <main className={`tp-page tp-page--tabbar ${styles.screen}`} aria-busy={milestones.isPending}>
      <header className={styles.header}>
        <IconButton icon="chevron-right" label="חזרה" onClick={() => navigate("/inbox")} />
        <div className={styles.heading}>
          <span className="tp-eyebrow">{studio.name}</span>
          <h1 className={styles.title}>{title}</h1>
        </div>
      </header>

      {milestones.isPending ? (
        <ListSkeleton />
      ) : milestones.isError ? (
        <LoadError error={milestones.error} onRetry={() => void milestones.refetch()} />
      ) : reached ? (
        <MilestoneCard
          input={{
            count,
            line: milestoneLine(count as Milestone),
            eyebrow: `${studio.name} · ${new Intl.DateTimeFormat("he-IL", { month: "long", timeZone }).format(new Date())}`,
            stats: milestoneStats(milestones.data),
          }}
        />
      ) : (
        <EmptyState
          icon="star"
          title="עוד לא הגעת לאבן הדרך הזו"
          action={
            <ButtonLink to="/book" variant="secondary">
              לשיעורים הקרובים
            </ButtonLink>
          }
        >
          {milestones.data.next
            ? `עד עכשיו ${milestones.data.attended} שיעורים. אבן הדרך הבאה: השיעור ה-${milestones.data.next}.`
            : `עד עכשיו ${milestones.data.attended} שיעורים.`}
        </EmptyState>
      )}
    </main>
  );
}

function MilestoneCard({ input }: { input: MilestoneCardInput }) {
  const toast = useToast();
  const canvas = useRef<HTMLCanvasElement>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let current = true;
    const ctx = canvas.current?.getContext("2d");
    if (!ctx) return;
    drawMilestone(ctx, input);
    // Drawn again once the card's faces arrive; the first draw keeps the screen from waiting on the network.
    void loadCardFonts().then(() => {
      if (current) drawMilestone(ctx, input);
    });
    return () => {
      current = false;
    };
  }, [input]);

  async function share(save: boolean) {
    setBusy(true);
    try {
      const file = await milestoneFile(input);
      if (!file) {
        toast.show({ message: "לא הצלחנו להכין את התמונה", tone: "danger" });
        return;
      }
      if (!save && navigator.canShare?.({ files: [file] })) {
        await navigator.share({ files: [file] }).catch(() => undefined);
        return;
      }
      saveFile(file, file.name);
      toast.show({ message: "התמונה נשמרה" });
    } finally {
      setBusy(false);
    }
  }

  const summary = [input.line, ...input.stats.map((stat) => `${stat.value} ${stat.label}`)].join(", ");
  return (
    <div className={`tp-rise ${styles.milestone}`}>
      <canvas
        ref={canvas}
        width={CARD_WIDTH}
        height={CARD_HEIGHT}
        className={styles.milestoneCard}
        role="img"
        aria-label={summary}
      />
      <p className="tp-caption">רק את רואה את הכרטיס הזה. הוא יוצא מכאן רק אם תשתפי אותו.</p>
      <div className={styles.milestoneActions}>
        <Button icon="share" loading={busy} onClick={() => void share(false)}>
          שיתוף הכרטיס
        </Button>
        <Button variant="secondary" disabled={busy} onClick={() => void share(true)}>
          שמירת התמונה
        </Button>
      </div>
    </div>
  );
}
