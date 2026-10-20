import { useState, type FormEvent } from "react";
import { errorMessage } from "../../api/errors";
import {
  Banner,
  Button,
  Checkbox,
  Dialog,
  Field,
  Input,
  Skeleton,
  Textarea,
  useToast,
} from "../../shared/design-system";
import { PictureField } from "../../shared/PictureField";
import { useInstructorProfiles, useSaveInstructorProfile, type Instructor } from "../console/experience";
import { useStudio } from "../console/studio";

/**
 * An instructor's profile as members see it on a class (docs/33 section 5): photo, one line, a short bio, Instagram
 * and the class playlist. Managers edit anyone's; an instructor edits their own, and only they choose whether strangers
 * see it on the public page and stories too (docs/37 M-14).
 */
export function InstructorProfileDialog({
  membershipId,
  name,
  onClose,
}: {
  membershipId: string;
  name: string;
  onClose: () => void;
}) {
  const profiles = useInstructorProfiles();
  const own = profiles.data?.get(membershipId);
  return (
    <Dialog open onClose={onClose} title={`פרופיל מדריך · ${name}`} description="כך המתאמנים יראו אותך בדף השיעור.">
      {profiles.isError ? (
        <Banner tone="danger" icon="info">
          {errorMessage(profiles.error, "לא הצלחנו לטעון את הפרופיל. נסו שוב.")}
        </Banner>
      ) : !profiles.data ? (
        <Skeleton height={320} />
      ) : (
        <ProfileForm membershipId={membershipId} profile={own} onClose={onClose} />
      )}
    </Dialog>
  );
}

function ProfileForm({
  membershipId,
  profile,
  onClose,
}: {
  membershipId: string;
  profile: Instructor | undefined;
  onClose: () => void;
}) {
  const toast = useToast();
  const save = useSaveInstructorProfile(membershipId);
  const [headline, setHeadline] = useState(profile?.headline ?? "");
  const [bio, setBio] = useState(profile?.bio ?? "");
  const [instagram, setInstagram] = useState(profile?.instagramHandle ? `@${profile.instagramHandle}` : "");
  const [playlist, setPlaylist] = useState(profile?.playlistUrl ?? "");
  const [visible, setVisible] = useState(profile?.visible ?? true);
  const [publicProfile, setPublicProfile] = useState(profile?.publicProfile ?? false);
  // The consent is the instructor's own; the API refuses it from anyone else (M-14).
  const own = membershipId === useStudio().membership.membershipId;

  const submit = (event: FormEvent) => {
    event.preventDefault();
    save.mutate(
      {
        headline: headline.trim() || null,
        bio: bio.trim() || null,
        instagramHandle: instagram.trim() || null,
        playlistUrl: playlist.trim() || null,
        visible,
        ...(own ? { publicProfile } : {}),
      },
      {
        onSuccess: () => {
          toast.show({ tone: "success", icon: "check", message: "הפרופיל נשמר" });
          onClose();
        },
      },
    );
  };

  return (
    <form className="tp-stack" onSubmit={submit} noValidate>
      <PictureField
        label="תמונה"
        purpose="instructor_photo"
        ownerId={membershipId}
        url={profile?.photoSmallUrl ?? profile?.photoUrl}
        shape="round"
      />
      <Field label="שורה אחת עליך" help={`${headline.length} מתוך 80 תווים`}>
        <Input
          value={headline}
          maxLength={80}
          placeholder="למשל: מורה לפילאטיס מכשירים"
          onChange={(event) => setHeadline(event.target.value)}
        />
      </Field>
      <Field label="קצת עליך" help={`${bio.length} מתוך 600 תווים`}>
        <Textarea value={bio} maxLength={600} rows={4} onChange={(event) => setBio(event.target.value)} />
      </Field>
      <Field label="אינסטגרם" help="שם משתמש או קישור לפרופיל.">
        <Input
          value={instagram}
          dir="ltr"
          autoComplete="off"
          placeholder="@studio.name"
          onChange={(event) => setInstagram(event.target.value)}
        />
      </Field>
      <Field label="פלייליסט לשיעורים" help="קישור מ־Spotify, Apple Music או YouTube Music.">
        <Input
          value={playlist}
          dir="ltr"
          inputMode="url"
          autoComplete="off"
          placeholder="https://open.spotify.com/playlist/…"
          onChange={(event) => setPlaylist(event.target.value)}
        />
      </Field>
      <Checkbox
        label="הפרופיל מוצג למתאמנים"
        checked={visible}
        onChange={(event) => setVisible(event.target.checked)}
      />
      {own ? (
        <div className="tp-stack" style={{ gap: 4 }}>
          <Checkbox
            label="להציג את הפרופיל שלי גם בעמוד הציבורי"
            checked={publicProfile}
            onChange={(event) => setPublicProfile(event.target.checked)}
          />
          <p className="tp-field__help">
            השם, התמונה, השורה עליך והאינסטגרם יופיעו גם למי שעוד לא מתאמן בסטודיו ובסטוריז.
          </p>
        </div>
      ) : (
        <p className="tp-caption tp-muted">
          {profile?.publicProfile
            ? "הפרופיל מוצג גם בעמוד הציבורי."
            : "הפרופיל לא מוצג בעמוד הציבורי. אפשר להפעיל את זה רק מהפרופיל האישי."}
        </p>
      )}
      {save.isError && (
        <Banner tone="danger" icon="info">
          {errorMessage(save.error, "לא הצלחנו לשמור את הפרופיל. נסו שוב.")}
        </Banner>
      )}
      <div className="tp-row" style={{ justifyContent: "flex-end", gap: 8 }}>
        <Button variant="secondary" onClick={onClose}>
          ביטול
        </Button>
        <Button type="submit" loading={save.isPending}>
          שמירה
        </Button>
      </div>
    </form>
  );
}
