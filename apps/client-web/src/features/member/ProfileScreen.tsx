import { useState } from "react";
import { Link } from "react-router";
import { Avatar, Button, Card, Chip, Icon, IconButton, Skeleton, useToast } from "../../shared/design-system";
import { activeMemberships, membershipRoleName, nameOf, useAccount } from "../../account/account";
import { useAuth } from "../../auth/AuthProvider";
import { useApi } from "../../api/ApiProvider";
import { forgetPushOnSignOut } from "../../account/push";
import { useProfile } from "./data";
import { useStudioProfile } from "../../account/studioProfile";
import { ConsentRows } from "./ConsentRows";
import { EditNameDialog } from "./EditNameDialog";
import { GoalDialog } from "./GoalDialog";
import { MyDetailsDialog } from "./MyDetailsDialog";
import { PassesCard } from "./Passes";
import { useMyProgress } from "./progress";
import styles from "./member.module.css";
import { StudioNotices } from "./StudioNotices";

export function ProfileScreen() {
  const profile = useProfile();
  const toast = useToast();
  const auth = useAuth();
  const api = useApi();
  const [signingOut, setSigningOut] = useState(false);
  const me = useAccount();
  const [editing, setEditing] = useState(false);
  const [details, setDetails] = useState(false);
  const [goalOpen, setGoalOpen] = useState(false);
  const soon = () => toast.show({ message: "האפשרות הזו תגיע בקרוב" });
  const studios = activeMemberships(me);
  const studio = studios[0];
  const studioProfile = useStudioProfile(studio?.organization.id);
  const progress = useMyProgress(studio?.organization.id);

  if (!profile.data) {
    return (
      <main className={`tp-page tp-page--tabbar ${styles.screen}`} aria-busy="true">
        <Skeleton height={56} />
        <Skeleton height={300} />
      </main>
    );
  }

  // The health declaration stays sample data until the studio API has it; the passes and the rest are real.
  const { healthDeclarationSigned } = profile.data;
  const name = nameOf(me);
  return (
    <main className={`tp-page tp-page--tabbar ${styles.screen} ${styles.profile}`}>
      <header className={styles.header}>
        <Avatar name={name} size="lg" />
        <div className={styles.heading}>
          <h1 className={styles.title}>{name}</h1>
          <span className="tp-ltr tp-muted" dir="ltr">
            {me.email}
          </span>
        </div>
        <IconButton icon="edit" label="עריכת פרטים" onClick={() => setEditing(true)} />
      </header>
      <StudioNotices />

      {studio && <PassesCard organizationId={studio.organization.id} />}

      <Card as="section" small className={styles.studio} aria-label="הסטודיו שלך">
        {studio ? (
          <>
            <span className="tp-rail__logo tp-rail__logo--sm" aria-hidden="true">
              {studio.organization.displayName.replace(/^סטודיו\s+/, "").charAt(0)}
            </span>
            <div className={styles.studioName}>
              <div>{studio.organization.displayName}</div>
              <div className="tp-caption">{membershipRoleName(studio)}</div>
            </div>
            {studios.length > 1 && (
              <Button variant="ghost" size="sm" onClick={soon}>
                החלפת סטודיו
              </Button>
            )}
          </>
        ) : (
          <div className={styles.studioName}>
            <div>עוד לא הצטרפת לסטודיו</div>
            <div className="tp-caption">בקשו מהסטודיו קישור הצטרפות או הזמנה במייל.</div>
          </div>
        )}
      </Card>

      <Card as="section" tone="cream" className={styles.settings} aria-labelledby="notifications">
        <h2 id="notifications" className={`tp-label tp-muted ${styles.settingsTitle}`}>
          התראות
        </h2>
        <ConsentRows organizationId={studio?.organization.id} studioName={studio?.organization.displayName} />
        <Link to="/profile/notifications" className="tp-setting">
          <span className={styles.settingText}>
            <span>העדפות התראות</span>
            <span className="tp-caption">תזכורות, התראות בטלפון ושעות שקטות</span>
          </span>
          <Icon name="chevron-left" />
        </Link>
      </Card>

      <Card as="section" tone="cream" className={styles.settings} aria-labelledby="account">
        <h2 id="account" className={`tp-label tp-muted ${styles.settingsTitle}`}>
          חשבון
        </h2>
        {studio && studioProfile.data && (
          <>
            <button type="button" className="tp-setting" onClick={() => setDetails(true)}>
              <span>הפרטים שלי</span>
              <Icon name="chevron-left" />
            </button>
            <hr className="tp-divider" />
          </>
        )}
        {studio && progress.data && (
          <>
            <button type="button" className="tp-setting" onClick={() => setGoalOpen(true)}>
              <span className={styles.settingText}>
                <span>יעד חודשי</span>
                <span className="tp-caption">
                  {progress.data.monthlyGoal === null
                    ? "לא הוגדר"
                    : progress.data.monthlyGoal === 1
                      ? "שיעור אחד בחודש"
                      : `${progress.data.monthlyGoal} שיעורים בחודש`}
                </span>
              </span>
              <Icon name="chevron-left" />
            </button>
            <hr className="tp-divider" />
          </>
        )}
        <div className="tp-setting">
          <span>הצהרת בריאות</span>
          {healthDeclarationSigned ? <Chip tone="success">נחתמה</Chip> : <Chip tone="warning">חסרה</Chip>}
        </div>
        <hr className="tp-divider" />
        <button type="button" className="tp-setting" onClick={soon}>
          <span>קבלות ותשלומים</span>
          <Icon name="chevron-left" />
        </button>
        <hr className="tp-divider" />
        <div className="tp-setting">
          <span>שפה</span>
          <span className="tp-muted">עברית</span>
        </div>
      </Card>

      <Button
        variant="ghost-danger"
        block
        loading={signingOut}
        onClick={() => {
          setSigningOut(true);
          // A shared browser must not keep this member's push (docs/30 section 4.3).
          void forgetPushOnSignOut(api).finally(() => auth.client?.signOut());
        }}
      >
        התנתקות
      </Button>

      <EditNameDialog open={editing} onClose={() => setEditing(false)} name={me.displayName ?? ""} />
      {goalOpen && studio && progress.data && (
        <GoalDialog
          organizationId={studio.organization.id}
          goal={progress.data.monthlyGoal}
          onClose={() => setGoalOpen(false)}
        />
      )}
      {details && studio && studioProfile.data && (
        <MyDetailsDialog
          organizationId={studio.organization.id}
          studioName={studio.organization.displayName}
          profile={studioProfile.data}
          onClose={() => setDetails(false)}
        />
      )}
    </main>
  );
}
