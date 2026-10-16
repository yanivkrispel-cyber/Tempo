import type { ReactNode } from "react";
import { cx } from "./cx";
import { Icon } from "./Icon";

/** A push body is the first paragraph, cut to this many characters (docs/30 section 6). */
export const PUSH_BODY_LIMIT = 120;

export type TemplateChannel = "inbox" | "push";

export interface TemplatePreviewProps {
  channel: TemplateChannel;
  /** The subject; the push title. */
  subject: string;
  /** Markdown-light: paragraphs split by a blank line, **bold**, [text](https://…), {{variables}}. */
  body: string;
  /** Sample values by variable name (`person.firstName`); a variable without one stays visible as written. */
  values?: Readonly<Record<string, string>>;
  /** The accessible name of the preview. */
  label?: string;
  className?: string;
}

const inline = /\*\*(.+?)\*\*|\[([^\]\n]+)\]\(([^)\s]+)\)|\{\{\s*([A-Za-z][\w.]*)\s*\}\}/g;
const variable = /^\{\{\s*([A-Za-z][\w.]*)\s*\}\}$/;

const paragraphs = (body: string) =>
  body
    .replace(/\r\n?/g, "\n")
    .split(/\n[ \t]*\n/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean);

/**
 * Only a web link or an app path becomes a link; anything else (javascript:, data:) stays text. The URL parser reads
 * `\` as `/` and drops tabs and newlines, so `/\evil.example` or `/<tab>/evil.example` would leave the site: a link
 * with a backslash, whitespace or a control character stays text too.
 */
function safeHref(raw: string, values: Readonly<Record<string, string>>): string | null {
  const match = variable.exec(raw);
  const href = match ? values[match[1] ?? ""] : raw;
  // eslint-disable-next-line no-control-regex
  return href && /^(https:\/\/|\/(?![/\\]))/i.test(href) && !/[\s\\\u0000-\u001f\u007f]/.test(href) ? href : null;
}

/** React elements only, never HTML: a studio's text cannot inject markup (docs/30 section 6). */
function renderInline(text: string, values: Readonly<Record<string, string>>, key: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  let last = 0;
  for (const match of text.matchAll(inline)) {
    const index = match.index ?? 0;
    if (index > last) nodes.push(text.slice(last, index));
    const at = `${key}-${index}`;
    const [whole, bold, linkText, linkHref, name] = match;
    if (bold !== undefined) {
      nodes.push(<strong key={at}>{renderInline(bold, values, at)}</strong>);
    } else if (linkText !== undefined) {
      const href = safeHref(linkHref ?? "", values);
      nodes.push(
        href ? (
          // An app path stays in this tab; a web link opens a new one.
          <a key={at} href={href} {...(href.startsWith("/") ? {} : { target: "_blank", rel: "noreferrer" })}>
            {renderInline(linkText, values, at)}
          </a>
        ) : (
          linkText
        ),
      );
    } else if (name !== undefined) {
      nodes.push(
        values[name] !== undefined ? (
          values[name]
        ) : (
          <span key={at} className="tp-template-preview__var">
            {whole}
          </span>
        ),
      );
    }
    last = index + whole.length;
  }
  if (last < text.length) nodes.push(text.slice(last));
  return nodes;
}

/** The subject as the API sends it: variables filled, no markup (a `**` or `[x](y)` shows as written). */
function renderSubject(text: string, values: Readonly<Record<string, string>>): ReactNode[] {
  return text.split(/(\{\{\s*[A-Za-z][\w.]*\s*\}\})/).map((part, index) => {
    const name = variable.exec(part)?.[1];
    if (name === undefined) return part;
    return (
      values[name] ?? (
        <span key={`t-${index}`} className="tp-template-preview__var">
          {part}
        </span>
      )
    );
  });
}

/** The push body as plain text: the first paragraph without markup, variables filled, at most 120 characters. */
export function pushBody(body: string, values: Readonly<Record<string, string>> = {}): string {
  const first = paragraphs(body)[0] ?? "";
  const plain = first
    .replace(/\{\{\s*([A-Za-z][\w.]*)\s*\}\}/g, (whole, name: string) => values[name] ?? whole)
    .replace(/\[([^\]\n]+)\]\([^)\s]+\)/g, "$1")
    .replace(/\*\*/g, "")
    .replace(/\s+/g, " ")
    .trim();
  const characters = Array.from(plain);
  return characters.length > PUSH_BODY_LIMIT
    ? `${characters
        .slice(0, PUSH_BODY_LIMIT - 1)
        .join("")
        .trimEnd()}…`
    : plain;
}

/**
 * How a notification will read: the inbox item (subject and the Markdown-light body) or the push banner (subject
 * as the title, the first paragraph cut at 120 characters). Direction follows the text, so RTL and LTR both read right.
 */
export function TemplatePreview({ channel, subject, body, values = {}, label, className }: TemplatePreviewProps) {
  const name = label ?? (channel === "push" ? "תצוגה מקדימה של התראת פוש" : "תצוגה מקדימה של הודעה בתיבה");
  const title = renderSubject(subject, values);

  if (channel === "push") {
    return (
      <div role="group" aria-label={name} className={cx("tp-template-preview tp-template-preview--push", className)}>
        <span className="tp-template-preview__tile" aria-hidden="true">
          <Icon name="bell" />
        </span>
        <div className="tp-template-preview__text">
          <p className="tp-template-preview__title" dir="auto">
            {title}
          </p>
          <p className="tp-template-preview__body" dir="auto">
            {pushBody(body, values)}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div role="group" aria-label={name} className={cx("tp-template-preview", className)}>
      <p className="tp-template-preview__title" dir="auto">
        {title}
      </p>
      <div className="tp-template-preview__body">
        {paragraphs(body).map((paragraph, index) => (
          <p key={index} dir="auto">
            {paragraph
              .split("\n")
              .flatMap((line, lineIndex) => [
                ...(lineIndex > 0 ? [<br key={`br-${lineIndex}`} />] : []),
                ...renderInline(line, values, `p${index}-${lineIndex}`),
              ])}
          </p>
        ))}
      </div>
    </div>
  );
}
