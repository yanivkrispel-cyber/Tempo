import { useQuery } from "@tanstack/react-query";
import { unwrap } from "@tempo/api-client";
import { Fragment, useMemo } from "react";
import faqMarkdown from "../../../../../docs/pilot/faq.md?raw";
import { useApi } from "../../api/ApiProvider";
import { Card, CardTitle, Icon } from "../../shared/design-system";
import { parseFaq } from "./faq";
import styles from "./help.module.css";

/**
 * `/o/:slug/help`: Tempo's contact and the pilot FAQ (board #584, PL-4), for every staff member. The contact is a
 * guide, not a gate: when none is set or the read fails, the card is left out and the questions stay.
 */
export function HelpPage() {
  const sections = useMemo(() => parseFaq(faqMarkdown), []);
  return (
    <>
      <header>
        <span className="tp-eyebrow">Tempo</span>
        <h1>עזרה ויצירת קשר</h1>
      </header>

      <ContactCard />

      {sections.map((section, index) => (
        <Card as="section" key={section.title} aria-labelledby={`faq-${index}`} className="tp-stack">
          <CardTitle id={`faq-${index}`}>{section.title}</CardTitle>
          <div className={styles.questions}>
            {section.items.map((item) => (
              <details key={item.question} className={styles.question}>
                <summary>{item.question}</summary>
                {item.answer.map((paragraph) => (
                  <p key={paragraph}>
                    <Marked text={paragraph} />
                  </p>
                ))}
              </details>
            ))}
          </div>
        </Card>
      ))}
    </>
  );
}

function ContactCard() {
  const api = useApi();
  const support = useQuery({
    queryKey: ["support-contact"],
    queryFn: () => unwrap(api.GET("/api/v1/support-contact")),
    staleTime: 10 * 60 * 1000,
  });
  const { contact, kind } = support.data ?? { contact: null, kind: null };
  // The API sends only an address or an https link; anything else (a `javascript:` link) is never put in an href.
  if (!contact || !kind || (kind === "url" && !contact.startsWith("https://"))) return null;

  return (
    <Card as="section" aria-labelledby="help-contact" className={`tp-stack ${styles.contact}`}>
      <div className={styles.contactHead}>
        <span className={styles.tile} aria-hidden="true">
          <Icon name={kind === "email" ? "mail" : "phone"} />
        </span>
        <div className="tp-stack" style={{ gap: 4, minWidth: 0 }}>
          <CardTitle id="help-contact">יצירת קשר</CardTitle>
          <p className="tp-caption tp-muted">שאלה, תקלה או בקשה: כותבים לנו, ונחזור אליכם.</p>
        </div>
      </div>
      {kind === "email" ? (
        <a className="tp-btn" href={`mailto:${contact}`}>
          <Icon name="mail" />
          <bdi className="tp-ltr">{contact}</bdi>
        </a>
      ) : (
        <a className="tp-btn" href={contact} target="_blank" rel="noreferrer">
          <Icon name="phone" />
          פתיחת שיחה
        </a>
      )}
    </Card>
  );
}

/** `**words**` in the FAQ names a screen or a button; it shows bold, as on the screen itself. */
function Marked({ text }: { text: string }) {
  return text
    .split("**")
    .map((part, index) =>
      index % 2 === 1 ? <strong key={index}>{part}</strong> : <Fragment key={index}>{part}</Fragment>,
    );
}
