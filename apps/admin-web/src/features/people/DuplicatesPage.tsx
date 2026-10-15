import { useInfiniteQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { unwrap, type Schemas } from "@tempo/api-client";
import type { ReactNode } from "react";
import { Link } from "react-router";
import { useApi } from "../../api/ApiProvider";
import { errorMessage } from "../../api/errors";
import { Banner, Button, Card, Chip, Skeleton, useToast } from "../../shared/design-system";
import { displayPhone } from "../../shared/utilities/phones";
import { useStudio } from "../console/studio";
import { sourceLabel } from "./labels";

type Candidate = Schemas["DuplicateCandidate"];
type Person = Schemas["Person"];

const reasonLabel: Record<Candidate["reason"], string> = {
  email: "אותו מייל",
  phone: "אותו טלפון",
  name_birth_date: "אותו שם ותאריך לידה"
};

/** `/o/:slug/duplicates`: pairs the API flagged as possibly one person (docs/27 section 4.6); nothing merges by itself. */
export function DuplicatesPage() {
  const api = useApi();
  const { organizationId } = useStudio();
  const candidates = useInfiniteQuery({
    queryKey: ["studio", organizationId, "duplicates"],
    queryFn: ({ pageParam }) =>
      unwrap(
        api.GET("/api/v1/organizations/{organizationId}/duplicate-candidates", {
          params: { path: { organizationId }, query: { status: "open", limit: 20, before: pageParam ?? undefined } }
        })
      ),
    initialPageParam: null as string | null,
    getNextPageParam: (page) => page.nextBefore ?? null
  });
  const items = candidates.data?.pages.flatMap((page) => page.items) ?? [];

  return (
    <>
      <header>
        <span className="tp-eyebrow">ניהול</span>
        <h1>כפילויות</h1>
        <p className="tp-muted">רשומות שאולי שייכות לאותו אדם. איחוד מעביר את פרטי הקשר, ההסכמות והקשרים לרשומה שנשארת.</p>
      </header>

      {candidates.isError ? (
        <Banner tone="danger" icon="info">
          {errorMessage(candidates.error, "לא הצלחנו לטעון את הכפילויות. נסו שוב.")}
        </Banner>
      ) : !candidates.data ? (
        <Skeleton height={160} />
      ) : items.length === 0 ? (
        <p className="tp-muted">אין כפילויות שמחכות להחלטה.</p>
      ) : (
        <div className="tp-stack">
          {items.map((candidate) => (
            <CandidateCard key={candidate.id} candidate={candidate} />
          ))}
        </div>
      )}

      {candidates.hasNextPage && (
        <div>
          <Button variant="secondary" loading={candidates.isFetchingNextPage} onClick={() => void candidates.fetchNextPage()}>
            עוד כפילויות
          </Button>
        </div>
      )}
    </>
  );
}

function CandidateCard({ candidate }: { candidate: Candidate }) {
  const api = useApi();
  const queryClient = useQueryClient();
  const toast = useToast();
  const { organizationId } = useStudio();
  const resolve = useMutation({
    mutationFn: (body: Schemas["ResolveDuplicateRequest"]) =>
      unwrap(
        api.POST("/api/v1/organizations/{organizationId}/duplicate-candidates/{candidateId}/resolve", {
          params: { path: { organizationId, candidateId: candidate.id } },
          body
        })
      ),
    onSuccess: (_, body) => toast.show({ tone: "success", icon: "check", message: body.resolution === "merge" ? "הרשומות אוחדו" : "סומנו כשני אנשים" }),
    onError: (error) => toast.show({ tone: "danger", icon: "info", message: errorMessage(error, "לא הצלחנו לשמור. נסו שוב.") }),
    onSettled: () => {
      // A merge moves contacts, consent and relationships to the survivor, so cached person cards are dropped
      // rather than shown stale while they refetch.
      queryClient.removeQueries({ queryKey: ["studio", organizationId, "person"] });
      return Promise.all([
        queryClient.invalidateQueries({ queryKey: ["studio", organizationId, "duplicates"] }),
        queryClient.invalidateQueries({ queryKey: ["studio", organizationId, "people"] })
      ]);
    }
  });
  const { personA, personB } = candidate;
  // Two records that both sign in are two people; the API refuses to merge them.
  const bothSignIn = personA.hasLogin && personB.hasLogin;

  return (
    <Card as="section" aria-label={`${personA.displayName} ו${personB.displayName}`} className="tp-stack">
      <div className="tp-row">
        <Chip tone="warning">{reasonLabel[candidate.reason]}</Chip>
      </div>
      <div className="tp-grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(min(240px, 100%), 1fr))", gap: "var(--space-4)" }}>
        {[personA, personB].map((person) => (
          <PersonSummary key={person.id} person={person}>
            {!bothSignIn && (
              <Button variant="secondary" size="sm" loading={resolve.isPending && resolve.variables?.survivorPersonId === person.id} onClick={() => resolve.mutate({ resolution: "merge", survivorPersonId: person.id })}>
                איחוד לרשומה הזו
              </Button>
            )}
          </PersonSummary>
        ))}
      </div>
      {bothSignIn && <p className="tp-caption tp-muted">לשתי הרשומות יש חשבון, ולכן אלה שני אנשים שונים.</p>}
      <div>
        <Button variant="ghost" size="sm" loading={resolve.isPending && resolve.variables?.resolution === "not_duplicate"} onClick={() => resolve.mutate({ resolution: "not_duplicate" })}>
          אלה שני אנשים שונים
        </Button>
      </div>
    </Card>
  );
}

function PersonSummary({ person, children }: { person: Person; children: ReactNode }) {
  return (
    <div className="tp-card tp-card--sm tp-stack" style={{ gap: 6 }}>
      <Link to={`../people/${person.id}`} relative="path">
        <strong>{person.displayName}</strong>
      </Link>
      <span className="tp-caption tp-muted">
        {sourceLabel[person.source]}
        {person.hasLogin && " · יש חשבון"}
      </span>
      {person.primaryPhone && <bdi className="tp-ltr">{displayPhone(person.primaryPhone)}</bdi>}
      {person.primaryEmail && <bdi className="tp-ltr">{person.primaryEmail}</bdi>}
      <div>{children}</div>
    </div>
  );
}
