export interface FaqItem {
  question: string;
  /** Paragraphs; `**words**` marks a screen or button name. */
  answer: string[];
}

export interface FaqSection {
  title: string;
  items: FaqItem[];
}

/**
 * Reads `docs/pilot/faq.md`, the one place the questions are written: `##` is a section, `###` a question, and the
 * paragraphs under it its answer. The title and the note before the first section are for whoever edits the file.
 */
export function parseFaq(markdown: string): FaqSection[] {
  const sections: FaqSection[] = [];
  let paragraph: string[] = [];

  const flush = () => {
    const item = sections.at(-1)?.items.at(-1);
    if (item && paragraph.length > 0) item.answer.push(paragraph.join(" "));
    paragraph = [];
  };

  for (const raw of markdown.split(/\r?\n/)) {
    const line = raw.trim();
    if (line.startsWith("### ")) {
      flush();
      sections.at(-1)?.items.push({ question: line.slice(4), answer: [] });
    } else if (line.startsWith("## ")) {
      flush();
      sections.push({ title: line.slice(3), items: [] });
    } else if (line === "" || line.startsWith("# ")) {
      flush();
    } else {
      paragraph.push(line);
    }
  }
  flush();
  return sections.filter((section) => section.items.length > 0);
}
