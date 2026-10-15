import { useMutation, useQueryClient } from "@tanstack/react-query";
import { unwrap, type Schemas } from "@tempo/api-client";
import { useState, type FormEvent } from "react";
import { useApi } from "../../api/ApiProvider";
import { errorMessage } from "../../api/errors";
import {
  Banner,
  Button,
  Chip,
  Dialog,
  EmptyState,
  Field,
  Input,
  Segmented,
  Select,
  Skeleton,
  Textarea,
  useToast,
} from "../../shared/design-system";
import { useStudio } from "../console/studio";
import {
  categoryLabel,
  categoryOptions,
  colorLabels,
  colors,
  minutesLabel,
  scheduleKeys,
  useClassTypes,
  wholeNumber,
  type ClassColor,
  type ClassType,
} from "./queries";

/** `/o/:slug/class-types`: what the studio teaches (docs/29 section 3). Archived types stay for past sessions. */
export function ClassTypesPage() {
  const studio = useStudio();
  const classTypes = useClassTypes();
  const [show, setShow] = useState<"active" | "archived">("active");
  const [editing, setEditing] = useState<ClassType | "new" | null>(null);
  const [archiving, setArchiving] = useState<ClassType | null>(null);
  const manage = studio.can("schedule.manage");
  const rows = (classTypes.data ?? []).filter((classType) => classType.status === show);

  return (
    <>
      <header className="tp-row" style={{ justifyContent: "space-between" }}>
        <div>
          <span className="tp-eyebrow">לוח שיעורים</span>
          <h1>סוגי שיעורים</h1>
        </div>
        {manage && (
          <Button icon="plus" onClick={() => setEditing("new")}>
            סוג שיעור חדש
          </Button>
        )}
      </header>

      <Segmented
        label="אילו סוגי שיעורים"
        value={show}
        onChange={setShow}
        options={[
          { value: "active", label: "פעילים" },
          { value: "archived", label: "בארכיון" },
        ]}
      />

      {classTypes.isError ? (
        <Banner tone="danger" icon="info">
          {errorMessage(classTypes.error, "לא הצלחנו לטעון את סוגי השיעורים. נסו שוב.")}
        </Banner>
      ) : !classTypes.data ? (
        <div aria-busy="true" className="tp-stack">
          <span className="tp-sr-only">טוענים את סוגי השיעורים…</span>
          <Skeleton height={48} />
          <Skeleton height={48} />
        </div>
      ) : rows.length === 0 ? (
        <EmptyState
          icon="list"
          title={show === "archived" ? "אין סוגי שיעורים בארכיון." : "עוד אין סוגי שיעורים."}
          action={
            manage && show === "active" ? (
              <Button variant="secondary" icon="plus" onClick={() => setEditing("new")}>
                סוג שיעור חדש
              </Button>
            ) : undefined
          }
        >
          {show === "active"
            ? "סוג שיעור הוא מה שמלמדים, למשל פילאטיס מכשירים. כל שיעור בלוח שייך לסוג אחד."
            : undefined}
        </EmptyState>
      ) : (
        <div className="tp-table-wrap">
          <table className="tp-table">
            <caption className="tp-sr-only">סוגי שיעורים</caption>
            <thead>
              <tr>
                <th scope="col">שם</th>
                <th scope="col">קטגוריה</th>
                <th scope="col">משך</th>
                {manage && (
                  <th scope="col">
                    <span className="tp-sr-only">פעולות</span>
                  </th>
                )}
              </tr>
            </thead>
            <tbody>
              {rows.map((classType) => (
                <tr key={classType.id}>
                  <td>
                    <Chip tone={`cat-${classType.color}`}>{classType.name}</Chip>
                  </td>
                  <td>{categoryLabel(classType.category)}</td>
                  <td className="tp-num">{minutesLabel(classType.defaultMinutes)}</td>
                  {manage && (
                    <td style={{ textAlign: "end" }}>
                      <span className="tp-row" style={{ gap: 4, justifyContent: "flex-end" }}>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setEditing(classType)}
                          aria-label={`עריכת ${classType.name}`}
                        >
                          עריכה
                        </Button>
                        {classType.status === "active" ? (
                          <Button
                            variant="ghost-danger"
                            size="sm"
                            onClick={() => setArchiving(classType)}
                            aria-label={`העברת ${classType.name} לארכיון`}
                          >
                            לארכיון
                          </Button>
                        ) : (
                          <RestoreButton classType={classType} />
                        )}
                      </span>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {editing && (
        <ClassTypeDialog
          classType={editing === "new" ? null : editing}
          inUse={(classTypes.data ?? []).map((item) => item.category)}
          onClose={() => setEditing(null)}
        />
      )}
      {archiving && <ArchiveDialog classType={archiving} onClose={() => setArchiving(null)} />}
    </>
  );
}

function usePatchClassType(classType: ClassType) {
  const api = useApi();
  const queryClient = useQueryClient();
  const { organizationId } = useStudio();
  return useMutation({
    mutationFn: (body: Schemas["UpdateClassTypeRequest"]) =>
      unwrap(
        api.PATCH("/api/v1/organizations/{organizationId}/class-types/{classTypeId}", {
          params: { path: { organizationId, classTypeId: classType.id }, header: { "If-Match": classType.version } },
          body,
        }),
      ),
    // Session tiles carry the type's name and color.
    onSettled: () => queryClient.invalidateQueries({ queryKey: scheduleKeys.all(organizationId) }),
  });
}

function RestoreButton({ classType }: { classType: ClassType }) {
  const restore = usePatchClassType(classType);
  const toast = useToast();
  return (
    <Button
      variant="ghost"
      size="sm"
      loading={restore.isPending}
      aria-label={`החזרת ${classType.name} מהארכיון`}
      onClick={() =>
        restore.mutate(
          { status: "active" },
          {
            onSuccess: () => toast.show({ tone: "success", icon: "check", message: "סוג השיעור חזר לרשימת הפעילים" }),
            onError: (error) => toast.show({ tone: "danger", icon: "info", message: errorMessage(error) }),
          },
        )
      }
    >
      החזרה
    </Button>
  );
}

function ArchiveDialog({ classType, onClose }: { classType: ClassType; onClose: () => void }) {
  const archive = usePatchClassType(classType);
  const toast = useToast();
  return (
    <Dialog
      open
      onClose={onClose}
      title={`להעביר את ${classType.name} לארכיון?`}
      description="אי אפשר יהיה לפתוח שיעורים חדשים מהסוג הזה. שיעורים שכבר בלוח נשארים כמו שהם."
      actions={
        <>
          <Button variant="secondary" onClick={onClose}>
            השארה
          </Button>
          <Button
            variant="danger"
            loading={archive.isPending}
            onClick={() =>
              archive.mutate(
                { status: "archived" },
                {
                  onSuccess: () => {
                    toast.show({ tone: "success", icon: "check", message: "סוג השיעור עבר לארכיון" });
                    onClose();
                  },
                },
              )
            }
          >
            העברה לארכיון
          </Button>
        </>
      }
    >
      {archive.isError && (
        <Banner tone="danger" icon="info">
          {errorMessage(archive.error, "לא הצלחנו להעביר לארכיון. נסו שוב.")}
        </Banner>
      )}
    </Dialog>
  );
}

function ClassTypeDialog({
  classType,
  inUse,
  onClose,
}: {
  classType: ClassType | null;
  inUse: string[];
  onClose: () => void;
}) {
  const api = useApi();
  const queryClient = useQueryClient();
  const toast = useToast();
  const { organizationId } = useStudio();
  const [name, setName] = useState(classType?.name ?? "");
  const [category, setCategory] = useState(classType?.category ?? "pilates");
  const [color, setColor] = useState<ClassColor>(classType?.color ?? "sage");
  const [minutes, setMinutes] = useState(String(classType?.defaultMinutes ?? 50));
  const [description, setDescription] = useState(classType?.description ?? "");
  const [submitted, setSubmitted] = useState(false);

  const save = useMutation({
    mutationFn: () => {
      const fields = { name: name.trim(), category, color, defaultMinutes: wholeNumber(minutes) ?? 0 };
      return classType
        ? unwrap(
            api.PATCH("/api/v1/organizations/{organizationId}/class-types/{classTypeId}", {
              params: {
                path: { organizationId, classTypeId: classType.id },
                header: { "If-Match": classType.version },
              },
              body: { ...fields, description: description.trim() || null },
            }),
          )
        : unwrap(
            api.POST("/api/v1/organizations/{organizationId}/class-types", {
              params: { path: { organizationId } },
              body: { ...fields, ...(description.trim() ? { description: description.trim() } : {}) },
            }),
          );
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: scheduleKeys.all(organizationId) });
      toast.show({ tone: "success", icon: "check", message: classType ? "סוג השיעור נשמר" : "סוג השיעור נוסף" });
      onClose();
    },
  });

  const minutesValue = wholeNumber(minutes);
  const nameError = name.trim() === "" ? "צריך שם" : null;
  const minutesError = minutesValue === null || minutesValue < 10 || minutesValue > 300 ? "בין 10 ל־300 דקות" : null;

  const submit = (event: FormEvent) => {
    event.preventDefault();
    setSubmitted(true);
    if (!nameError && !minutesError) save.mutate();
  };

  return (
    <Dialog
      open
      onClose={onClose}
      title={classType ? "עריכת סוג שיעור" : "סוג שיעור חדש"}
      actions={
        <>
          <Button variant="secondary" onClick={onClose}>
            ביטול
          </Button>
          <Button type="submit" form="class-type" loading={save.isPending}>
            שמירה
          </Button>
        </>
      }
    >
      <form id="class-type" className="tp-stack" onSubmit={submit} noValidate>
        <Field label="שם" required error={submitted ? nameError : undefined}>
          <Input
            value={name}
            onChange={(event) => setName(event.target.value)}
            maxLength={80}
            placeholder="למשל פילאטיס מכשירים"
          />
        </Field>
        <div className="tp-row" style={{ alignItems: "flex-start" }}>
          <Field label="קטגוריה" help="כרטיסייה יכולה להיות מוגבלת לקטגוריה אחת.">
            <Select value={category} onChange={(event) => setCategory(event.target.value)}>
              {categoryOptions(inUse).map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="משך בדקות" required error={submitted ? minutesError : undefined}>
            <Input
              inputMode="numeric"
              value={minutes}
              onChange={(event) => setMinutes(event.target.value)}
              style={{ maxWidth: 120 }}
            />
          </Field>
        </div>
        <Field label="צבע בלוח" help={<Chip tone={`cat-${color}`}>{name.trim() || "תצוגה מקדימה"}</Chip>}>
          <Select value={color} onChange={(event) => setColor(event.target.value as ClassColor)}>
            {colors.map((value) => (
              <option key={value} value={value}>
                {colorLabels[value]}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="תיאור">
          <Textarea
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            maxLength={1000}
            rows={3}
          />
        </Field>
        {save.isError && (
          <Banner tone="danger" icon="info">
            {errorMessage(save.error, "לא הצלחנו לשמור. נסו שוב.")}
          </Banner>
        )}
      </form>
    </Dialog>
  );
}
