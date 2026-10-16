import type { ReactNode } from "react";
import { Link } from "react-router";
import styles from "./member.module.css";

/**
 * Markdown-light as the API writes it (docs/30 section 6): paragraphs split by a blank line, line breaks kept,
 * `**bold**` and `[text](href)`. Filled-in values come escaped (`\*`, `\[`, `\\` ...), so a backslash always makes the
 * next character plain text. React elements only, never HTML.
 */
export function RichText({ text, links = true }: { text: string; links?: boolean }) {
  return (
    <>
      {text
        .replace(/\r\n?/g, "\n")
        .split(/\n[ \t]*\n/)
        .map((paragraph) => paragraph.trim())
        .filter(Boolean)
        .map((paragraph, index) => (
          <span key={index} className={styles.richParagraph}>
            {new Parser(paragraph, links, `p${index}`).nodes()}
          </span>
        ))}
    </>
  );
}

/**
 * Only an app path or an https link becomes a link. The URL parser reads `\` as `/` and drops tabs and newlines, so a
 * link with a backslash, whitespace or a control character stays text (as in the console's preview).
 */
export function safeHref(href: string): string | null {
  // eslint-disable-next-line no-control-regex
  return /^(https:\/\/|\/(?![/\\]))/i.test(href) && !/[\s\\\u0000-\u001f\u007f]/.test(href) ? href : null;
}

class Parser {
  private at = 0;
  private key = 0;

  constructor(
    private readonly text: string,
    private readonly links: boolean,
    private readonly prefix: string,
  ) {}

  nodes(): ReactNode[] {
    return this.until(null) ?? [];
  }

  /** Nodes up to `stop` (consumed), or null when `stop` never comes; at the end of the text when `stop` is null. */
  private until(stop: "**" | "]" | null): ReactNode[] | null {
    const nodes: ReactNode[] = [];
    let plain = "";
    const flush = () => {
      if (plain) nodes.push(plain);
      plain = "";
    };
    while (this.at < this.text.length) {
      const rest = this.text.slice(this.at);
      if (rest[0] === "\\" && rest.length > 1) {
        plain += rest[1];
        this.at += 2;
      } else if (stop && rest.startsWith(stop)) {
        this.at += stop.length;
        flush();
        return nodes;
      } else if (rest[0] === "\n") {
        flush();
        nodes.push(<br key={this.next()} />);
        this.at += 1;
      } else if (rest.startsWith("**") && stop !== "]") {
        const start = this.at;
        this.at += 2;
        const inner = this.until("**");
        if (inner && inner.length > 0) {
          flush();
          nodes.push(<strong key={this.next()}>{inner}</strong>);
        } else {
          this.at = start + 2;
          plain += "**";
        }
      } else if (rest[0] === "[" && stop === null) {
        const start = this.at;
        this.at += 1;
        const inner = this.until("]");
        const href = inner && /^\(([^)\s]*)\)/.exec(this.text.slice(this.at));
        if (inner && href) {
          this.at += href[0].length;
          flush();
          nodes.push(this.link(inner, href[1] ?? ""));
        } else {
          this.at = start + 1;
          plain += "[";
        }
      } else {
        plain += rest[0];
        this.at += 1;
      }
    }
    if (stop) return null;
    flush();
    return nodes;
  }

  private link(label: ReactNode[], raw: string): ReactNode {
    const href = this.links ? safeHref(raw) : null;
    const key = this.next();
    if (!href) return <span key={key}>{label}</span>;
    // An app path stays in the app; a web link opens a new tab.
    return href.startsWith("/") ? (
      <Link key={key} to={href}>
        {label}
      </Link>
    ) : (
      <a key={key} href={href} target="_blank" rel="noreferrer">
        {label}
      </a>
    );
  }

  private next() {
    return `${this.prefix}-${this.key++}`;
  }
}
