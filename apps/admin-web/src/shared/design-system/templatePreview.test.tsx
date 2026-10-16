import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it } from "vitest";
import { PUSH_BODY_LIMIT, pushBody, TemplatePreview, TimeRange, type TimeWindow } from "./index";

const values = {
  "person.firstName": "דנה",
  "session.classTypeName": "פילאטיס",
  "link.session": "https://example.com/s/1",
};

describe("TemplatePreview", () => {
  it("renders the inbox item: subject, paragraphs, bold, a link and filled variables", () => {
    render(
      <TemplatePreview
        channel="inbox"
        subject="היי {{person.firstName}}"
        body={"השיעור **{{session.classTypeName}}** בוטל.\n\n[לפרטים]({{link.session}})"}
        values={values}
      />,
    );
    const preview = screen.getByRole("group", { name: "תצוגה מקדימה של הודעה בתיבה" });
    expect(within(preview).getByText("היי דנה")).toBeInTheDocument();
    expect(within(preview).getByText("פילאטיס").tagName).toBe("STRONG");
    expect(within(preview).getByRole("link", { name: "לפרטים" })).toHaveAttribute("href", "https://example.com/s/1");
    expect(preview.querySelectorAll(".tp-template-preview__body p")).toHaveLength(2);
  });

  it("keeps a variable without a sample value visible as written", () => {
    render(<TemplatePreview channel="inbox" subject="שלום" body="נשארו {{pass.entriesLeft}} כניסות" />);
    expect(screen.getByText("{{pass.entriesLeft}}")).toHaveClass("tp-template-preview__var");
  });

  it("shows the subject as plain text with its variables filled, like the API sends it", () => {
    const { container } = render(
      <TemplatePreview
        channel="inbox"
        subject="**{{studio.name}}** [כאן](/home)"
        body="גוף"
        values={{ "studio.name": "נשימה" }}
      />,
    );
    expect(container.querySelector(".tp-template-preview__title")).toHaveTextContent("**נשימה** [כאן](/home)");
    expect(screen.queryByRole("link")).toBeNull();
  });

  it("never renders the studio's text as markup, and links only to https or an app path", () => {
    const { container } = render(
      <TemplatePreview
        channel="inbox"
        subject="<b>x</b>"
        body={
          '<img src=x onerror="alert(1)"> [לחצו](javascript:alert(1)) [בית](/home) [חוץ](/\\evil.example) [טאב]({{link}})'
        }
        values={{ link: "/\t/evil.example" }}
      />,
    );
    expect(container.querySelector("img, b")).toBeNull();
    expect(screen.getByText("<b>x</b>")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "לחצו" })).toBeNull();
    expect(screen.getByRole("link", { name: "בית" })).toHaveAttribute("href", "/home");
    expect(screen.getByRole("link", { name: "בית" })).not.toHaveAttribute("target");
    // The URL parser reads "\" as "/" and drops a tab: both would leave the site.
    expect(screen.queryByRole("link", { name: "חוץ" })).toBeNull();
    expect(screen.queryByRole("link", { name: "טאב" })).toBeNull();
  });

  it("shows push as the subject and the first paragraph, cut at 120 characters", () => {
    const long = "א".repeat(200);
    render(<TemplatePreview channel="push" subject="תזכורת" body={`${long}\n\nפסקה שנייה`} />);
    const preview = screen.getByRole("group", { name: "תצוגה מקדימה של התראת פוש" });
    expect(within(preview).getByText("תזכורת")).toBeInTheDocument();
    const body = within(preview).getByText(/^א+…$/).textContent ?? "";
    expect(Array.from(body)).toHaveLength(PUSH_BODY_LIMIT);
    expect(within(preview).queryByText("פסקה שנייה")).toBeNull();
  });

  it("strips markup from the push body and fills variables, including inside bold", () => {
    expect(pushBody("שלום **{{person.firstName}}**, [לשיעור]({{link.session}})", values)).toBe("שלום דנה, לשיעור");
    expect(pushBody("קצר")).toBe("קצר");
  });
});

describe("TimeRange", () => {
  function Harness({ initial }: { initial: TimeWindow }) {
    const [value, setValue] = useState(initial);
    return <TimeRange label="שעות שקטות" value={value} onChange={setValue} />;
  }

  it("groups the two times under its name and refuses the same start and end at the end field", async () => {
    render(<Harness initial={{ startsLocal: "22:00", endsLocal: "07:00" }} />);
    const group = screen.getByRole("group", { name: "שעות שקטות" });
    expect(within(group).queryByText("שעת הסיום צריכה להיות שונה משעת ההתחלה.")).toBeNull();
    const end = within(group).getByRole("combobox", { name: "עד" });
    await userEvent.clear(end);
    await userEvent.type(end, "22:00");
    await userEvent.tab();
    expect(await within(group).findByText("שעת הסיום צריכה להיות שונה משעת ההתחלה.")).toBeInTheDocument();
  });
});
