import { useMutation, useQueryClient } from "@tanstack/react-query";
import { unwrap, type Schemas } from "@tempo/api-client";
import { useState, type FormEvent } from "react";
import { Link } from "react-router";
import { useApi } from "../../api/ApiProvider";
import { errorMessage } from "../../api/errors";
import { Banner, Button, Card, Dialog, Field, Select, useToast } from "../../shared/design-system";
import { PersonPicker, type PickedPerson } from "../../shared/PersonPicker";
import { useStudio } from "../console/studio";

type PersonDetail = Schemas["PersonDetail"];
type Relationship = Schemas["Relationship"];

/**
 * The three ways a relationship reads from this person's card. The API's `from` side is the guardian or the
 * emergency contact (contract, CreateRelationshipRequest).
 */
type Kind = "guardian_of" | "has_guardian" | "has_emergency_contact";

const kinds: { value: Kind; label: string }[] = [
  { value: "has_guardian", label: "ההורה או האפוטרופוס הוא…" },
  { value: "guardian_of", label: "הורה או אפוטרופוס של…" },
  { value: "has_emergency_contact", label: "איש הקשר לחירום הוא…" },
];

function describe(relationship: Relationship, personId: string): string {
  const mine = relationship.fromPersonId === personId;
  if (relationship.type === "guardian_of") return mine ? "הורה או אפוטרופוס של" : "ההורה או האפוטרופוס:";
  return mine ? "איש קשר לחירום של" : "איש הקשר לחירום:";
}

/** Guardians and emergency contacts (docs/27 section 4.4): list, add by picking a person, remove. */
export function RelationshipsSection({ person, writable }: { person: PersonDetail; writable: boolean }) {
  const api = useApi();
  const queryClient = useQueryClient();
  const toast = useToast();
  const { organizationId } = useStudio();
  const [adding, setAdding] = useState(false);
  const remove = useMutation({
    mutationKey: [organizationId, "people.remove"],
    mutationFn: (relationship: Relationship) =>
      unwrap(
        api.DELETE("/api/v1/organizations/{organizationId}/people/{personId}/relationships/{relationshipId}", {
          params: { path: { organizationId, personId: person.id, relationshipId: relationship.id } },
        }),
      ),
    onSuccess: () => toast.show({ tone: "success", icon: "check", message: "הקשר הוסר" }),
    onError: (error) => toast.show({ tone: "danger", icon: "info", message: errorMessage(error) }),
    onSettled: () => queryClient.invalidateQueries({ queryKey: ["studio", organizationId, "person"] }),
  });

  return (
    <Card as="section" aria-labelledby="relationships" className="tp-stack">
      <div className="tp-row" style={{ justifyContent: "space-between" }}>
        <h2 id="relationships">קשרים</h2>
        {writable && (
          <Button variant="secondary" size="sm" icon="plus" onClick={() => setAdding(true)}>
            הוספת קשר
          </Button>
        )}
      </div>
      {person.relationships.length === 0 ? (
        <p className="tp-muted">אין הורים, אפוטרופסים או אנשי קשר לחירום.</p>
      ) : (
        <ul className="tp-stack" style={{ listStyle: "none", padding: 0, margin: 0, gap: 8 }}>
          {person.relationships.map((relationship) => {
            const other = relationship.fromPersonId === person.id ? relationship.toPersonId : relationship.fromPersonId;
            return (
              <li key={relationship.id} className="tp-row" style={{ justifyContent: "space-between" }}>
                <span>
                  {describe(relationship, person.id)}{" "}
                  <Link to={`../${other}`} relative="path">
                    {relationship.otherDisplayName}
                  </Link>
                </span>
                {writable && (
                  <Button
                    variant="ghost-danger"
                    size="sm"
                    onClick={() => remove.mutate(relationship)}
                    aria-label={`הסרת הקשר עם ${relationship.otherDisplayName}`}
                  >
                    הסרה
                  </Button>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {adding && <AddRelationshipDialog person={person} onClose={() => setAdding(false)} />}
    </Card>
  );
}

function AddRelationshipDialog({ person, onClose }: { person: PersonDetail; onClose: () => void }) {
  const api = useApi();
  const queryClient = useQueryClient();
  const toast = useToast();
  const { organizationId } = useStudio();
  const [kind, setKind] = useState<Kind>("has_guardian");
  const [picked, setPicked] = useState<PickedPerson | null>(null);

  const add = useMutation({
    mutationKey: [organizationId, "people.add"],
    mutationFn: (other: string) => {
      // The path's person is the guardian or the emergency contact.
      const [from, to, type] =
        kind === "guardian_of"
          ? [person.id, other, "guardian_of" as const]
          : kind === "has_guardian"
            ? [other, person.id, "guardian_of" as const]
            : [other, person.id, "emergency_contact_for" as const];
      return unwrap(
        api.POST("/api/v1/organizations/{organizationId}/people/{personId}/relationships", {
          params: { path: { organizationId, personId: from } },
          body: { type, toPersonId: to },
        }),
      );
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["studio", organizationId, "person"] });
      toast.show({ tone: "success", icon: "check", message: "הקשר נוסף" });
      onClose();
    },
  });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (picked) add.mutate(picked.id);
  };

  return (
    <Dialog
      open
      onClose={onClose}
      title="הוספת קשר"
      description={`קשר של ${person.displayName} לאדם אחר שכבר רשום בסטודיו.`}
      actions={
        <>
          <Button variant="secondary" onClick={onClose}>
            ביטול
          </Button>
          <Button type="submit" form="add-relationship" loading={add.isPending} disabled={!picked}>
            הוספה
          </Button>
        </>
      }
    >
      <form id="add-relationship" className="tp-stack" onSubmit={submit} noValidate>
        <Field label="סוג הקשר">
          <Select value={kind} onChange={(event) => setKind(event.target.value as Kind)}>
            {kinds.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </Select>
        </Field>
        <PersonPicker value={picked} onChange={setPicked} excludeId={person.id} />
        {add.isError && (
          <Banner tone="danger" icon="info">
            {errorMessage(add.error, "לא הצלחנו להוסיף את הקשר. נסו שוב.")}
          </Banner>
        )}
      </form>
    </Dialog>
  );
}
