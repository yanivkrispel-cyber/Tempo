import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { unwrap, type Schemas } from "@tempo/api-client";
import { useId, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { useApi } from "../../api/ApiProvider";
import { errorMessage } from "../../api/errors";
import { PictureField } from "../../shared/PictureField";
import {
  ACCENTS,
  Banner,
  Button,
  Card,
  Field,
  Icon,
  Input,
  Segmented,
  Skeleton,
  useToast,
  type AccentId,
  type IconName,
} from "../../shared/design-system";
import { useStudio } from "../console/studio";
import styles from "./settings.module.css";

type Brand = Schemas["Brand"];
type IconBackground = Brand["iconBackground"];

const APP_NAME_MAX = 12;
// The icon's light ground (StudioIcons.Paper); an accent ground is the accent's light `--brand`.
const PAPER = "#fbfaf8";

const backgrounds: { value: IconBackground; label: string }[] = [
  { value: "paper", label: "בהיר" },
  { value: "accent", label: "בצבע המותג" },
];

// The other apps on the preview's home screen: shapes only, so the studio's tile is the one that reads.
const neighbours: IconName[] = ["calendar", "image", "bell", "bar-chart", "users", "settings", "search"];

/**
 * Up to two letters for a studio without an icon (W-2): the first letter of each of the first two words, else a
 * word's first two letters, "T" when nothing is left. It mirrors the API's `StudioIcons.Initials`, which draws them.
 */
export function initials(name: string): string {
  const words = name
    .split(/\s+/)
    .map((word) => word.replace(/[^\p{L}\p{N}]/gu, ""))
    .filter((word) => word.length > 0);
  const letters = words.length === 0 ? "T" : words.length === 1 ? words[0]!.slice(0, 2) : words[0]![0]! + words[1]![0]!;
  return letters.toUpperCase();
}

/**
 * The studio's brand (WL3, docs/35 sections 2 to 5): the app name, accent, logo and home-screen icon that members
 * see, with a preview of the home screen that follows the form before it is saved. The console itself stays Tempo
 * (W-9).
 */
export function BrandCard() {
  const api = useApi();
  const { organizationId } = useStudio();
  const brand = useQuery({
    queryKey: ["studio", organizationId, "brand"],
    queryFn: () =>
      unwrap(api.GET("/api/v1/organizations/{organizationId}/brand", { params: { path: { organizationId } } })),
  });

  return (
    <Card as="section" aria-labelledby="studio-brand">
      <h2 id="studio-brand">המיתוג של הסטודיו</h2>
      <p className="tp-caption">השם, הצבע, הלוגו והסמל שהמתאמנים רואים באפליקציה ובמסך הבית. הקונסולה נשארת Tempo.</p>
      {brand.isError ? (
        <Banner tone="danger" icon="info">
          {errorMessage(brand.error, "לא הצלחנו לטעון את המיתוג. נסו שוב.")}
        </Banner>
      ) : !brand.data ? (
        <Skeleton height={320} />
      ) : (
        // Not keyed by version: an upload bumps it, and what was typed stays. The save sends the latest version.
        <BrandForm brand={brand.data} />
      )}
    </Card>
  );
}

function BrandForm({ brand }: { brand: Brand }) {
  const api = useApi();
  const queryClient = useQueryClient();
  const toast = useToast();
  const studio = useStudio();
  const { organizationId } = studio;
  const editable = studio.can("organization.settings.manage");
  const [appName, setAppName] = useState(brand.appName);
  const [accentId, setAccentId] = useState<AccentId>(brand.accentId);
  const [iconBackground, setIconBackground] = useState<IconBackground>(brand.iconBackground);
  // The mark just uploaded, before the server draws it on a ground: the preview can draw it on either one.
  const [mark, setMark] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);

  const save = useMutation({
    mutationKey: [organizationId, "settings.updateBrand"],
    mutationFn: (body: Schemas["BrandInput"]) =>
      unwrap(
        api.PUT("/api/v1/organizations/{organizationId}/brand", {
          params: { path: { organizationId }, header: { "If-Match": brand.version } },
          body,
        }),
      ),
    onSuccess: (updated) => {
      queryClient.setQueryData(["studio", organizationId, "brand"], updated);
      setMark(null);
      toast.show({ tone: "success", icon: "check", message: "המיתוג נשמר" });
    },
  });

  const name = appName.trim();
  const nameError = name.length === 0 ? "צריך שם של תו אחד לפחות" : null;
  const hasIcon = Boolean(brand.iconUrl || mark);
  const groundChanged = hasIcon && iconBackground !== brand.iconBackground;
  const changed = name !== brand.appName || accentId !== brand.accentId || iconBackground !== brand.iconBackground;

  const submit = (event: FormEvent) => {
    event.preventDefault();
    setSubmitted(true);
    if (!nameError && changed) save.mutate({ appName: name, accentId, iconBackground });
  };

  return (
    <div className={styles.brand}>
      <HomeScreenPreview
        appName={name || studio.displayName}
        accentId={accentId}
        initials={initials(studio.displayName)}
        iconUrl={brand.iconUrl}
        mark={mark}
        iconBackground={iconBackground}
        drawnOn={brand.iconBackground}
      />
      <form className={`tp-stack ${styles.brandForm}`} onSubmit={submit} noValidate>
        <Field
          label="שם האפליקציה"
          required
          error={submitted ? nameError : undefined}
          help={
            <span className={styles.counted}>
              <span>מופיע מתחת לסמל במסך הבית של הטלפון.</span>
              <span className="tp-num">{`${appName.length}/${APP_NAME_MAX}`}</span>
            </span>
          }
        >
          <Input
            value={appName}
            onChange={(event) => setAppName(event.target.value)}
            maxLength={APP_NAME_MAX}
            disabled={!editable}
          />
        </Field>
        <AccentPicker value={accentId} onChange={setAccentId} disabled={!editable} />
        {editable && (
          <>
            <PictureField
              label="לוגו"
              purpose="studio_logo"
              ownerId={organizationId}
              url={brand.logoSmallUrl}
              fit="contain"
              hint="מופיע בראש האפליקציה של המתאמנים. הכי טוב PNG שקוף או על רקע לבן."
              removeLabel="הסרת הלוגו"
            />
            <PictureField
              label="סמל למסך הבית"
              purpose="studio_icon"
              ownerId={organizationId}
              url={brand.iconUrl}
              shape="square"
              hint="ריבוע של 512 על 512 פיקסלים לפחות. בלי סמל, המתאמנים יראו את ראשי התיבות של הסטודיו בצבע המותג."
              removeLabel="הסרת הסמל"
              onUploaded={(media) => setMark(media.smallUrl)}
            />
          </>
        )}
        {hasIcon && (
          <div className="tp-field">
            <span className="tp-field__label">רקע הסמל</span>
            <Segmented
              label="רקע הסמל"
              options={backgrounds}
              value={iconBackground}
              onChange={(value) => editable && setIconBackground(value)}
            />
            {groundChanged && <p className="tp-field__help">הסמל יצויר מחדש על הרקע הזה בשמירה.</p>}
          </div>
        )}
        {save.isError && (
          <Banner tone="danger" icon="info">
            {errorMessage(save.error, "לא הצלחנו לשמור את המיתוג. נסו שוב.")}
          </Banner>
        )}
        {editable && (
          <div>
            <Button type="submit" loading={save.isPending} disabled={!changed}>
              שמירת המיתוג
            </Button>
          </div>
        )}
      </form>
    </div>
  );
}

/** The eight accents as a radio group (W-1): one tab stop, the arrow keys move along it. */
function AccentPicker({
  value,
  onChange,
  disabled,
}: {
  value: AccentId;
  onChange: (accent: AccentId) => void;
  disabled: boolean;
}) {
  const labelId = useId();
  const group = useRef<HTMLDivElement>(null);

  const move = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    // Right to left: the left arrow goes to the next accent.
    const steps: Record<string, number> = { ArrowLeft: 1, ArrowDown: 1, ArrowRight: -1, ArrowUp: -1 };
    const step = steps[event.key];
    if (step === undefined || disabled) return;
    event.preventDefault();
    const next = (index + step + ACCENTS.length) % ACCENTS.length;
    onChange(ACCENTS[next]!.id);
    group.current?.querySelectorAll<HTMLButtonElement>('[role="radio"]')[next]?.focus();
  };

  return (
    <div className="tp-field">
      <span id={labelId} className="tp-field__label">
        צבע המותג
      </span>
      <div ref={group} role="radiogroup" aria-labelledby={labelId} className={styles.accents}>
        {ACCENTS.map((accent, index) => {
          const checked = accent.id === value;
          return (
            <button
              key={accent.id}
              type="button"
              role="radio"
              aria-checked={checked}
              tabIndex={checked ? 0 : -1}
              disabled={disabled}
              className={styles.accent}
              onClick={() => onChange(accent.id)}
              onKeyDown={(event) => move(event, index)}
            >
              <span className={styles.swatch} style={{ background: accent.ground }} aria-hidden="true">
                {checked && <Icon name="check" />}
              </span>
              {accent.label}
            </button>
          );
        })}
      </div>
      <p className="tp-field__help">הכפתורים, הקישורים והסמל בלי תמונה מקבלים את הצבע הזה.</p>
    </div>
  );
}

/**
 * A phone's home screen with the studio's tile among others (W-3): the icon as it installs, or the initials on the
 * accent the API would draw. Colours are the light values whatever the console's theme, since that is the icon.
 */
function HomeScreenPreview({
  appName,
  accentId,
  initials: letters,
  iconUrl,
  mark,
  iconBackground,
  drawnOn,
}: {
  appName: string;
  accentId: AccentId;
  initials: string;
  iconUrl: string | null;
  mark: string | null;
  iconBackground: IconBackground;
  drawnOn: IconBackground;
}) {
  const ground = ACCENTS.find((accent) => accent.id === accentId)!.ground;
  const tile =
    mark && (iconBackground !== drawnOn || !iconUrl) ? (
      // A fresh mark on the chosen ground, in the box the API draws it in (StudioIcons.PlainBox, 72%).
      <span className={styles.tile} style={{ background: iconBackground === "paper" ? PAPER : ground }}>
        <img src={mark} alt="" className={styles.mark} />
      </span>
    ) : iconUrl ? (
      <span className={styles.tile}>
        <img src={iconUrl} alt="" className={styles.tileImage} />
      </span>
    ) : (
      <span
        className={`${styles.tile} ${letters.length > 1 ? styles.initials : styles.initial}`}
        style={{ background: ground }}
      >
        {letters}
      </span>
    );

  return (
    <figure className={styles.preview} aria-label="תצוגה במסך הבית" data-accent={accentId}>
      <span className="tp-eyebrow">כך זה נראה בטלפון</span>
      <div className={styles.phone}>
        <div className={styles.screen}>
          <div className={styles.statusBar} aria-hidden="true">
            <span className="tp-num">9:41</span>
            <span className={styles.statusIcons}>
              <i />
              <i />
              <i />
            </span>
          </div>
          <div className={styles.apps}>
            <span className={styles.app}>
              {tile}
              <span className={styles.appName}>{appName}</span>
            </span>
            {neighbours.map((icon) => (
              <span key={icon} className={styles.app} aria-hidden="true">
                <span className={`${styles.tile} ${styles.neighbour}`}>
                  <Icon name={icon} />
                </span>
                <span className={styles.nameBar} />
              </span>
            ))}
          </div>
          <div className={styles.dock} aria-hidden="true">
            {(["phone", "mail", "camera", "music"] as IconName[]).map((icon) => (
              <span key={icon} className={`${styles.tile} ${styles.neighbour}`}>
                <Icon name={icon} />
              </span>
            ))}
          </div>
        </div>
      </div>
      <div className={styles.sample}>
        <span className="tp-caption">באפליקציה של המתאמנים</span>
        <span className={styles.sampleRow} aria-hidden="true">
          <span className="tp-btn tp-btn--primary tp-btn--sm">הזמנת מקום</span>
          <span className="tp-chip tp-chip--brand">מקומות פנויים</span>
        </span>
      </div>
    </figure>
  );
}
