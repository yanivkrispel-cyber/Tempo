import { useState } from "react";
import {
  Avatar,
  Button,
  Card,
  Chip,
  Icon,
  IconButton,
  ProgressBar,
  Select,
  Skeleton,
  shortDate,
  useToast,
} from "../../shared/design-system";
import { activeMemberships, membershipRoleName, nameOf, useAccount } from "../../account/account";
import { useAuth } from "../../auth/AuthProvider";
import { useProfile } from "./data";
import { useStudioProfile } from "../../account/studioProfile";
import { ConsentRows } from "./ConsentRows";
import { EditNameDialog } from "./EditNameDialog";
import { MyDetailsDialog } from "./MyDetailsDialog";
import styles from "./member.module.css";
import { StudioNotices } from "./StudioNotices";

export function ProfileScreen() {
  const profile = useProfile();
  const toast = useToast();
  const auth = useAuth();
  const me = useAccount();
  const [editing, setEditing] = useState(false);
  const [details, setDetails] = useState(false);
  const soon = () => toast.show({ message: "האפשרות הזו תגיע בקרוב" });
  const studios = activeMemberships(me);
  const studio = studios[0];
  const studioProfile = useStudioProfile(studio?.organization.id);

  if (!profile.data) {
    return (
      <main className={`tp-page tp-page--tabbar ${styles.screen}`} aria-busy="true">
        <Skeleton height={56} />
        <Skeleton height={300} />
      </main>
    );
  }

  // The plan and the health declaration stay sample data until the studio API exists; the rest is the account.
  const { plan, healthDeclarationSigned } = profile.data;
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

      <Card as="section" tone="base" className={styles.plan} aria-labelledby="plan-name">
        <div className={styles.planHead}>
          <span className="tp-eyebrow">המנוי שלך</span>
          <span className="tp-icon-tile tp-icon-tile--sm">
            <Icon name="credit-card" />
          </span>
        </div>
        <h2 id="plan-name" className={styles.planName}>
          {plan.name}
        </h2>
        <span>
          מתחדש אוטומטית ב-{shortDate(plan.renewsOn)} · ויזה <bdi>{plan.card}</bdi>
        </span>
        <ProgressBar
          tone="sand"
          value={plan.periodDays - plan.daysLeft}
          max={plan.periodDays}
          label="ימים שעברו בתקופה הנוכחית"
        />
        <span className="tp-caption">עוד {plan.daysLeft} ימים בתקופה הנוכחית</span>
      </Card>

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
        <div className="tp-setting">
          <span className={styles.settingText}>
            <span>תזכורת לפני שיעור</span>
            <span className="tp-caption">כמה זמן לפני</span>
          </span>
          <Select aria-label="תזכורת לפני שיעור" className={styles.settingSelect} defaultValue="2h">
            <option value="2h">שעתיים</option>
            <option value="1h">שעה</option>
            <option value="1d">יום לפני</option>
          </Select>
        </div>
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

      <Button variant="ghost-danger" block onClick={() => auth.client?.signOut()}>
        התנתקות
      </Button>

      <EditNameDialog open={editing} onClose={() => setEditing(false)} name={me.displayName ?? ""} />
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
