import { useState } from "react";
import { errorMessage } from "../../api/errors";
import { Avatar, Banner, Button, Card, Field, Input, useToast } from "../../shared/design-system";
import { useBuddies, useBuddyCode, useLinkBuddy, useUnlinkBuddy } from "./experience";
import styles from "./member.module.css";

/**
 * Buddies (docs/33 section 4, D18): a member shares a one-time code with a friend at the studio; when the friend
 * enters it, each sees where the other booked on the room map. Either one ends it here.
 */
export function BuddiesCard({ organizationId }: { organizationId: string }) {
  const toast = useToast();
  const buddies = useBuddies(organizationId);
  const newCode = useBuddyCode(organizationId);
  const link = useLinkBuddy(organizationId);
  const unlink = useUnlinkBuddy(organizationId);
  const [code, setCode] = useState("");

  async function share(value: string) {
    const text = `הקוד שלי לחברות בסטודיו: ${value}`;
    if (navigator.share) {
      await navigator.share({ text }).catch(() => undefined);
    } else {
      await navigator.clipboard?.writeText(value).catch(() => undefined);
      toast.show({ message: "הקוד הועתק" });
    }
  }

  return (
    <Card as="section" className={styles.settings} aria-labelledby="buddies">
      <h2 id="buddies" className={`tp-label tp-muted ${styles.settingsTitle}`}>
        חברות בסטודיו
      </h2>
      <p className="tp-caption">
        חברה שתקבל ממך קוד תוכל לראות באיזה מכשיר שריינת, ואת תראי את שלה. אחרים רואים רק שהמקום תפוס.
      </p>
      {(buddies.data ?? []).map((buddy) => (
        <div key={buddy.personId} className="tp-setting">
          <span className={styles.buddy}>
            <Avatar name={buddy.displayName} size="sm" />
            <bdi>{buddy.displayName}</bdi>
          </span>
          <Button
            variant="ghost-danger"
            size="sm"
            loading={unlink.isPending && unlink.variables === buddy.personId}
            onClick={() => unlink.mutate(buddy.personId)}
          >
            הסרה
          </Button>
        </div>
      ))}
      {newCode.data ? (
        <div className={styles.buddyCode}>
          <span className="tp-display" dir="ltr">
            {newCode.data.code}
          </span>
          <span className="tp-caption">הקוד עובד פעם אחת, במשך 48 שעות.</span>
          <Button variant="secondary" size="sm" icon="share" onClick={() => void share(newCode.data.code)}>
            שליחה לחברה
          </Button>
        </div>
      ) : (
        <Button variant="secondary" icon="users" loading={newCode.isPending} onClick={() => newCode.mutate()}>
          יצירת קוד לחברה
        </Button>
      )}
      <form
        className={styles.buddyForm}
        onSubmit={(event) => {
          event.preventDefault();
          link.mutate(code, {
            onSuccess: (buddy) => {
              setCode("");
              toast.show({ tone: "success", message: `את ו${buddy.displayName} חברות עכשיו` });
            },
          });
        }}
      >
        <Field label="קיבלת קוד מחברה?">
          <Input
            value={code}
            onChange={(event) => setCode(event.target.value)}
            dir="ltr"
            autoComplete="off"
            placeholder="K7QM-X3RT"
          />
        </Field>
        <Button
          type="submit"
          size="sm"
          disabled={code.replace(/[^a-z0-9]/gi, "").length !== 8}
          loading={link.isPending}
        >
          הוספה
        </Button>
      </form>
      {link.isError && (
        <Banner tone="danger" icon="info">
          {errorMessage(link.error, "הקוד לא עבד. בדקו אותו ונסו שוב.")}
        </Banner>
      )}
    </Card>
  );
}
