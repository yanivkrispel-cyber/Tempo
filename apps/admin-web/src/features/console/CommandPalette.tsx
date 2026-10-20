import { createContext, useContext, useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router";
import { Avatar, Icon, type IconName } from "../../shared/design-system";
import { useStudioTimeZone } from "../../shared/studio/timeZone";
import { dateIn, formatDate } from "../../shared/utilities/dates";
import { clockTime } from "../../shared/utilities/times";
import { useSearch } from "./experience";
import { useStudio } from "./studio";

export interface PaletteSection {
  to: string;
  label: string;
  icon: IconName;
}

interface Option {
  key: string;
  to: string;
  label: string;
  hint?: string;
  icon?: IconName;
  person?: { displayName: string; avatarUrl?: string | null };
}

const PaletteOpener = createContext<(() => void) | null>(null);

/** Lets a page open the console's palette from its own search field (the today page's top bar). */
export const CommandPaletteProvider = PaletteOpener.Provider;

/** Opens the palette; null outside the console frame. */
export function useOpenCommandPalette(): (() => void) | null {
  return useContext(PaletteOpener);
}

/** Ctrl K or ⌘K anywhere in the console opens the palette (docs/33 section 9, P8). */
export function useCommandPalette() {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const onKey = (event: globalThis.KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setOpen((value) => !value);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);
  return { open, setOpen };
}

/**
 * Search people and the coming classes, or jump to a section, from the keyboard: arrows move, Enter opens, Escape
 * closes. A combobox over a list box, so a screen reader hears each option as it moves.
 */
export function CommandPalette({ sections, onClose }: { sections: PaletteSection[]; onClose: () => void }) {
  const studio = useStudio();
  const navigate = useNavigate();
  const { timeZone } = useStudioTimeZone();
  const [q, setQ] = useState("");
  const [active, setActive] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const listId = useId();
  const search = useSearch(q);
  const term = q.trim();

  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    input.current?.focus();
    return () => {
      if (opener?.isConnected) opener.focus();
    };
  }, []);

  const base = `/o/${studio.slug}`;
  const sectionOptions: Option[] = sections
    .filter((section) => term === "" || section.label.includes(term))
    .map((section) => ({
      key: `section-${section.to}`,
      to: section.to ? `${base}/${section.to}` : base,
      label: section.label,
      icon: section.icon,
    }));
  const found = term.length >= 2 ? search.data : undefined;
  const people: Option[] = (found?.people ?? []).map((person) => ({
    key: `person-${person.id}`,
    to: `${base}/people/${person.id}`,
    label: person.displayName,
    hint: "כרטיס אדם",
    person,
  }));
  const classes: Option[] = (found?.sessions ?? []).map((session) => ({
    key: `session-${session.id}`,
    to: `${base}/schedule/sessions/${session.id}`,
    label: session.className,
    hint: timeZone
      ? `${formatDate(dateIn(session.startsAt, timeZone))} · ${clockTime(session.startsAt, timeZone)}${session.instructorName ? ` · ${session.instructorName}` : ""}`
      : undefined,
    icon: "calendar",
  }));
  const options = [...people, ...classes, ...sectionOptions];
  const current = Math.min(active, Math.max(0, options.length - 1));

  const go = (option: Option | undefined) => {
    if (!option) return;
    onClose();
    void navigate(option.to);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActive((current + 1) % Math.max(1, options.length));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActive((current - 1 + options.length) % Math.max(1, options.length));
    } else if (event.key === "Enter") {
      event.preventDefault();
      go(options[current]);
    } else if (event.key === "Escape") {
      event.preventDefault();
      onClose();
    } else if (event.key === "Tab") {
      // The input is the dialog's only focusable element; Tab must not leave the modal.
      event.preventDefault();
    }
  };

  return createPortal(
    <>
      <div className="tp-scrim" aria-hidden="true" onClick={onClose} />
      <div className="tp-cmdk" role="dialog" aria-modal="true" aria-label="חיפוש בסטודיו">
        <input
          ref={input}
          className="tp-cmdk__input"
          role="combobox"
          aria-expanded="true"
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={options[current] ? `${listId}-${current}` : undefined}
          aria-label="חיפוש אנשים, שיעורים ומסכים"
          placeholder="חיפוש אנשים, שיעורים ומסכים…"
          value={q}
          onChange={(event) => {
            setQ(event.target.value);
            setActive(0);
          }}
          onKeyDown={onKeyDown}
        />
        <ul id={listId} className="tp-cmdk__list" role="listbox" aria-label="תוצאות" style={{ margin: 0 }}>
          {options.length === 0 ? (
            <li className="tp-caption" style={{ padding: 12 }}>
              {term.length >= 2 && search.isFetching
                ? "מחפשים…"
                : term.length >= 2 && search.isError
                  ? "החיפוש לא הצליח. נסו שוב."
                  : "לא נמצא כלום."}
            </li>
          ) : (
            options.map((option, index) => (
              <li
                key={option.key}
                id={`${listId}-${index}`}
                role="option"
                aria-selected={index === current}
                className="tp-cmdk__item"
                onMouseEnter={() => setActive(index)}
                onMouseDown={(event) => {
                  // The input keeps focus; the keyboard reaches options through it.
                  event.preventDefault();
                  go(option);
                }}
              >
                {option.person ? (
                  <Avatar name={option.person.displayName} src={option.person.avatarUrl ?? undefined} size="sm" />
                ) : (
                  <Icon name={option.icon ?? "list"} />
                )}
                <span style={{ flex: 1, minWidth: 0 }}>
                  <bdi>{option.label}</bdi>
                  {option.hint && (
                    <span className="tp-caption tp-num" style={{ display: "block" }}>
                      {option.hint}
                    </span>
                  )}
                </span>
              </li>
            ))
          )}
        </ul>
      </div>
    </>,
    document.body,
  );
}
