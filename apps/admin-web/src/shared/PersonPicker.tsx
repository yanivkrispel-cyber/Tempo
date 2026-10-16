import { useQuery } from "@tanstack/react-query";
import { unwrap } from "@tempo/api-client";
import { useState } from "react";
import { useApi } from "../api/ApiProvider";
import { errorMessage } from "../api/errors";
import { useStudio } from "../features/console/studio";
import { Banner, Button, Field, Input } from "./design-system";
import { useDebounced } from "./useDebounced";
import { phoneSearchText } from "./utilities/phones";

export interface PickedPerson {
  id: string;
  displayName: string;
}

export interface PersonPickerProps {
  value: PickedPerson | null;
  onChange: (person: PickedPerson | null) => void;
  /** Left out of the results, e.g. the person whose card this is. */
  excludeId?: string;
}

/**
 * Finds one active person record by name, phone or email (`people.view`) and picks it. The search waits until the
 * typing pauses, and a failed search says so instead of "no one found".
 */
export function PersonPicker({ value, onChange, excludeId }: PersonPickerProps) {
  const api = useApi();
  const { organizationId } = useStudio();
  const [text, setText] = useState("");
  const typed = text.trim();
  const query = useDebounced(typed, 300);
  const found = useQuery({
    queryKey: ["studio", organizationId, "people", { query, status: "active", picker: true }],
    queryFn: () =>
      unwrap(
        api.GET("/api/v1/organizations/{organizationId}/people", {
          params: { path: { organizationId }, query: { query: phoneSearchText(query), status: "active", limit: 8 } },
        }),
      ),
    enabled: query.length >= 2 && !value,
  });
  const candidates = (found.data?.items ?? []).filter((candidate) => candidate.id !== excludeId);
  const searching = found.isFetching || typed !== query;

  if (value) {
    return (
      <div className="tp-row" style={{ justifyContent: "space-between" }}>
        <strong>{value.displayName}</strong>
        <Button variant="ghost" size="sm" onClick={() => onChange(null)}>
          החלפה
        </Button>
      </div>
    );
  }

  const pick = (candidate: PickedPerson) => onChange({ id: candidate.id, displayName: candidate.displayName });

  return (
    <>
      <Field label="חיפוש אדם" help="לפי שם, טלפון או מייל">
        <Input type="search" value={text} onChange={(event) => setText(event.target.value)} />
      </Field>
      {typed.length >= 2 &&
        (found.isError && !searching ? (
          <Banner tone="danger" icon="info">
            {errorMessage(found.error, "החיפוש נכשל. נסו שוב.")}
          </Banner>
        ) : (
          <ul className="tp-menu" role="listbox" aria-label="תוצאות">
            {candidates.length === 0 || typed !== query ? (
              <li className="tp-menu__item" role="option" aria-selected="false" aria-disabled="true">
                {searching ? "מחפשים…" : "לא נמצא אף אחד"}
              </li>
            ) : (
              candidates.map((candidate) => (
                <li
                  key={candidate.id}
                  role="option"
                  aria-selected="false"
                  className="tp-menu__item"
                  tabIndex={0}
                  onClick={() => pick(candidate)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      pick(candidate);
                    }
                  }}
                >
                  {candidate.displayName}
                </li>
              ))
            )}
          </ul>
        ))}
    </>
  );
}
