import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { unwrap, type Schemas } from "@tempo/api-client";
import { useState, type FormEvent, type SyntheticEvent } from "react";
import { useParams } from "react-router";
import { useApi } from "../../api/ApiProvider";
import { errorMessage, hasCode, isNotFound } from "../../api/errors";
import {
  Banner,
  Button,
  ButtonLink,
  Card,
  Chip,
  EmptyState,
  Field,
  Input,
  PUSH_BODY_LIMIT,
  pushBody,
  Skeleton,
  Tabs,
  TemplatePreview,
  Textarea,
  useToast,
} from "../../shared/design-system";
import { useStudio } from "../console/studio";
import { templatesKey } from "./TemplatesCard";
import {
  groupLabels,
  kindLabel,
  unknownVariableError,
  unknownVariables,
  variableLabel,
  type TemplateChannelName,
  type TemplateField,
} from "./templates";

type NotificationTemplate = Schemas["NotificationTemplate"];
type Words = { subject: string; body: string };
type Drafts = Record<TemplateChannelName, Words>;

const LOCALE = "he";
const SUBJECT_MAX = 120;
const BODY_MAX = 2000;
const channels: { value: TemplateChannelName; label: string }[] = [
  { value: "inbox", label: "תיבת ההודעות" },
  { value: "push", label: "התראה בטלפון" },
];

/** `/o/:slug/settings/templates/:kind`: one kind's words per channel, with variables and a live preview. */
export function TemplatePage() {
  const api = useApi();
  const studio = useStudio();
  const kind = useParams().kind ?? "";
  const allowed = studio.can("organization.settings.manage");
  const template = useQuery({
    queryKey: [...templatesKey(studio.organizationId), kind, LOCALE],
    queryFn: () =>
      unwrap(
        api.GET("/api/v1/organizations/{organizationId}/notification-templates/{kind}", {
          params: { path: { organizationId: studio.organizationId, kind }, query: { locale: LOCALE } },
        }),
      ),
    enabled: allowed,
  });

  return (
    <>
      <header className="tp-stack" style={{ gap: 6 }}>
        <ButtonLink to={`/o/${studio.slug}/settings`} variant="ghost" size="sm" icon="chevron-right">
          חזרה להגדרות
        </ButtonLink>
        <span className="tp-eyebrow">{template.data ? groupLabels[template.data.group] : "נוסחי ההודעות"}</span>
        <h1>{kindLabel(kind)}</h1>
      </header>
      {!allowed ? (
        <Banner tone="info" icon="info">
          רק מי שמנהל את הגדרות הסטודיו יכול לשנות את נוסחי ההודעות.
        </Banner>
      ) : template.isError ? (
        isNotFound(template.error) ? (
          <EmptyState icon="info" title="אין נוסח להודעה הזו">
            להודעה הזו אין נוסח שאפשר לשנות.
          </EmptyState>
        ) : (
          <Banner tone="danger" icon="info">
            {errorMessage(template.error, "לא הצלחנו לטעון את הנוסח. נסו שוב.")}
          </Banner>
        )
      ) : !template.data ? (
        <Skeleton height={420} />
      ) : (
        // Keyed by version: after a save the form starts again from what the API returned.
        <TemplateForm key={template.data.version} template={template.data} />
      )}
    </>
  );
}

const wordsOf = (template: NotificationTemplate): Drafts => ({
  inbox: { subject: template.channels.inbox.subject, body: template.channels.inbox.body },
  push: { subject: template.channels.push.subject, body: template.channels.push.body },
});

function TemplateForm({ template }: { template: NotificationTemplate }) {
  const api = useApi();
  const studio = useStudio();
  const queryClient = useQueryClient();
  const toast = useToast();
  const saved = wordsOf(template);
  const [drafts, setDrafts] = useState<Drafts>(saved);
  const [channel, setChannel] = useState<TemplateChannelName>("inbox");
  // Where "insert a variable" writes: the field last focused and its caret.
  const [caret, setCaret] = useState<{ field: "subject" | "body"; at: number } | null>(null);
  const [submitted, setSubmitted] = useState(false);

  const save = useMutation({
    mutationKey: [studio.organizationId, "notification-templates.update", template.kind],
    mutationFn: (body: Schemas["NotificationTemplateInput"]) =>
      unwrap(
        api.PUT("/api/v1/organizations/{organizationId}/notification-templates/{kind}", {
          params: {
            path: { organizationId: studio.organizationId, kind: template.kind },
            header: { "If-Match": template.version },
          },
          body,
        }),
      ),
    // A refused variable is shown at its field, so open that field's channel.
    onError: (error) => {
      const refused = unknownVariableError(error);
      if (refused) setChannel(refused.field.split(".")[0] as TemplateChannelName);
    },
    onSuccess: async (updated, body) => {
      queryClient.setQueryData([...templatesKey(studio.organizationId), template.kind, LOCALE], updated);
      await queryClient.invalidateQueries({ queryKey: templatesKey(studio.organizationId), exact: true });
      const reset = body.inbox === null && template.channels.inbox.source === "studio";
      const resetPush = body.push === null && template.channels.push.source === "studio";
      toast.show({
        tone: "success",
        icon: "check",
        message: reset || resetPush ? "הנוסח חזר לנוסח של Tempo" : "הנוסח נשמר",
      });
    },
  });

  const changed = (name: TemplateChannelName) =>
    drafts[name].subject !== saved[name].subject || drafts[name].body !== saved[name].body;
  const dirty = changed("inbox") || changed("push");

  // What the PUT sends for a channel: the edited words, or what is in use now (the studio's words, or null for the
  // default). The PUT always carries both channels.
  const inUse = (name: TemplateChannelName): Words | null =>
    template.channels[name].source === "studio" ? saved[name] : null;
  const channelBody = (name: TemplateChannelName): Words | null =>
    changed(name) ? { subject: drafts[name].subject.trim(), body: drafts[name].body.trim() } : inUse(name);

  const localError = (field: TemplateField): string | undefined => {
    const [name, part] = field.split(".") as [TemplateChannelName, "subject" | "body"];
    const text = drafts[name][part];
    if (!text.trim()) return part === "subject" ? "צריך כותרת." : "צריך גוף הודעה.";
    const unknown = unknownVariables(text, template.variables);
    if (unknown.length > 0) return `המשתנה {{${unknown[0]}}} לא קיים בהודעה הזו. בחרו מהרשימה.`;
    return undefined;
  };
  const serverError = unknownVariableError(save.error);
  const fieldError = (field: TemplateField) =>
    (submitted ? localError(field) : undefined) ??
    (serverError?.field === field
      ? `המשתנה ${serverError.variable ? `{{${serverError.variable}}} ` : ""}לא קיים בהודעה הזו. בחרו מהרשימה.`
      : undefined);
  const allFields: TemplateField[] = ["inbox.subject", "inbox.body", "push.subject", "push.body"];

  const submit = (event: FormEvent) => {
    event.preventDefault();
    setSubmitted(true);
    const invalid = allFields.find((field) => localError(field));
    if (invalid) {
      setChannel(invalid.split(".")[0] as TemplateChannelName);
      return;
    }
    if (dirty) save.mutate({ locale: LOCALE, inbox: channelBody("inbox"), push: channelBody("push") });
  };

  // Only this channel goes back; the other keeps what is in use, without unsaved edits.
  const toDefault = (name: TemplateChannelName) =>
    save.mutate({
      locale: LOCALE,
      inbox: name === "inbox" ? null : inUse("inbox"),
      push: name === "push" ? null : inUse("push"),
    });

  const setWords = (name: TemplateChannelName, words: Partial<Words>) =>
    setDrafts({ ...drafts, [name]: { ...drafts[name], ...words } });

  const remember = (field: "subject" | "body") => (event: SyntheticEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setCaret({ field, at: event.currentTarget.selectionStart ?? event.currentTarget.value.length });

  const insert = (variable: string) => {
    const field = caret?.field ?? "body";
    const text = drafts[channel][field];
    const at = Math.min(caret?.field === field ? caret.at : text.length, text.length);
    const token = `{{${variable}}}`;
    setWords(channel, { [field]: text.slice(0, at) + token + text.slice(at) });
    setCaret({ field, at: at + token.length });
  };

  const words = drafts[channel];
  const source = template.channels[channel].source;
  const pushPreview = pushBody(words.body, template.sampleValues);
  const pushCut = Array.from(pushBody(words.body)).length >= PUSH_BODY_LIMIT;

  return (
    <form className="tp-stack" onSubmit={submit} noValidate>
      <Tabs tabs={channels} value={channel} onChange={setChannel} label="ערוץ">
        <div className="tp-stack" style={{ paddingBlockStart: 12 }}>
          <div>
            <Chip tone={source === "studio" ? "brand" : "neutral"}>
              {source === "studio" ? "נוסח של הסטודיו" : "נוסח Tempo"}
            </Chip>
          </div>
          <Card as="section" aria-label={`עריכה: ${channels.find((item) => item.value === channel)?.label}`}>
            <div className="tp-stack">
              <Field
                label={channel === "push" ? "כותרת ההתראה" : "כותרת"}
                required
                error={fieldError(`${channel}.subject`)}
              >
                <Input
                  value={words.subject}
                  maxLength={SUBJECT_MAX}
                  dir="auto"
                  onChange={(event) => {
                    setWords(channel, { subject: event.target.value });
                    remember("subject")(event);
                  }}
                  onSelect={remember("subject")}
                  onFocus={remember("subject")}
                />
              </Field>
              <Field
                label="גוף ההודעה"
                required
                help={
                  channel === "push"
                    ? `בפוש נשלחת רק הפסקה הראשונה, בלי עיצוב, עד ${PUSH_BODY_LIMIT} תווים.`
                    : "שורה ריקה מתחילה פסקה. **מודגש**, [טקסט](https://…) לקישור."
                }
                error={fieldError(`${channel}.body`)}
              >
                <Textarea
                  value={words.body}
                  maxLength={BODY_MAX}
                  rows={channel === "push" ? 3 : 6}
                  dir="auto"
                  onChange={(event) => {
                    setWords(channel, { body: event.target.value });
                    remember("body")(event);
                  }}
                  onSelect={remember("body")}
                  onFocus={remember("body")}
                />
              </Field>
              <div role="group" aria-labelledby="insert-variable" className="tp-stack" style={{ gap: 6 }}>
                <span id="insert-variable" className="tp-label">
                  הוספת משתנה {caret?.field === "subject" ? "לכותרת" : "לגוף ההודעה"}
                </span>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                  {template.variables.map((variable) => (
                    <Button key={variable} type="button" variant="secondary" size="sm" onClick={() => insert(variable)}>
                      {variableLabel(variable)}
                    </Button>
                  ))}
                </div>
              </div>
            </div>
          </Card>
          <section className="tp-stack" style={{ gap: 6 }} aria-labelledby="preview-title">
            <h2 id="preview-title" className="tp-label tp-muted">
              תצוגה מקדימה, עם פרטים לדוגמה
            </h2>
            <TemplatePreview
              channel={channel}
              subject={words.subject}
              body={words.body}
              values={template.sampleValues}
            />
            {channel === "push" && pushCut && (
              <p className="tp-caption tp-muted" aria-live="polite">
                הגוף ארוך מ־{PUSH_BODY_LIMIT} תווים ונחתך בפוש ({Array.from(pushPreview).length} תווים מוצגים).
              </p>
            )}
          </section>
        </div>
      </Tabs>

      {save.isError && !serverError && (
        <Banner tone="danger" icon="info">
          {hasCode(save.error, "template.invalid")
            ? "הכותרת או הגוף ריקים או ארוכים מדי."
            : hasCode(save.error, "concurrency.conflict")
              ? "מישהו אחר שינה את הנוסח בינתיים. רעננו ונסו שוב."
              : errorMessage(save.error, "לא הצלחנו לשמור את הנוסח. נסו שוב.")}
        </Banner>
      )}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 12 }}>
        <Button type="submit" loading={save.isPending} disabled={!dirty}>
          שמירת הנוסח
        </Button>
        {source === "studio" && (
          <Button type="button" variant="ghost" disabled={save.isPending} onClick={() => toDefault(channel)}>
            חזרה לנוסח של Tempo
          </Button>
        )}
      </div>
    </form>
  );
}
