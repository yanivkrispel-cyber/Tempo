import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter } from "react-router";
import { describe, expect, it } from "vitest";
import { App } from "../../app/App";
import { routes } from "../../app/routes";
import { apiStub, json, membershipAs, sampleMe } from "../../test/api";
import { signedInAuth } from "../../test/auth";

// Made-up people and notes only (public repo, board #321); no health information in any note.
const studio = sampleMe.memberships[0]!;
const org = `/api/v1/organizations/${studio.organization.id}`;
const personId = "0199e5a1-0000-7000-8000-000000000901";
const morning = { id: "0199e5a1-0000-7000-8000-000000000911", name: "בוקר", color: 1 };
const evening = { id: "0199e5a1-0000-7000-8000-000000000912", name: "ערב", color: 4 };
const tag = (base: typeof morning, peopleCount: number, version = "1") => ({
  ...base,
  peopleCount,
  createdAt: "2026-10-17T08:00:00Z",
  version,
});

const person = (tags: unknown[] = [morning]) => ({
  id: personId,
  displayName: "מאיה דמו",
  givenName: "מאיה",
  familyName: "דמו",
  birthDate: null,
  status: "active",
  source: "import",
  hasLogin: false,
  membershipId: null,
  primaryEmail: "maya@example.com",
  primaryPhone: null,
  mergedIntoId: null,
  createdAt: "2026-10-17T08:00:00Z",
  version: "1",
  tags,
});
const detail = (tags?: unknown[]) => ({ ...person(tags), contactPoints: [], consents: [], relationships: [] });

const mine = {
  id: "0199e5a1-0000-7000-8000-000000000922",
  body: "מעדיפה את השורה הראשונה",
  createdAt: "2026-10-17T09:00:00Z",
  authorMembershipId: studio.membershipId,
  authorName: "דנה כהן",
  authorRole: "staff",
  mine: true,
};
const theirs = {
  id: "0199e5a1-0000-7000-8000-000000000921",
  body: "שילמה על כרטיסייה במזומן",
  createdAt: "2026-10-16T09:00:00Z",
  authorMembershipId: "0199e5a1-0000-7000-8000-000000000099",
  authorName: null,
  authorRole: "owner",
  mine: false,
};

function renderAt(
  url: string,
  routesForApi: Record<string, unknown>,
  permissions?: string[],
  role: "owner" | "admin" | "staff" | "client" = "owner",
) {
  const membership = permissions ? { ...membershipAs(role), permissions } : membershipAs(role);
  const api = apiStub({ "POST /api/v1/session": { ...sampleMe, memberships: [membership] }, ...routesForApi });
  render(
    <App
      router={createMemoryRouter(routes, { initialEntries: [url] })}
      auth={signedInAuth()}
      apiUrl="https://api.test"
      fetch={api.fetch}
    />,
  );
  return api;
}

const staff = ["organization.view", "members.view", "people.view", "people.manage", "people.notes.view", "people.notes.manage"];
const sent = (api: ReturnType<typeof apiStub>, method: string, path: string) =>
  api.requests.filter((request) => request.method === method && new URL(request.url).pathname === `${org}${path}`);

describe("tags on the person card", () => {
  it("lets staff put a studio tag on the person and take one off", async () => {
    const api = renderAt(
      `/o/neshima/people/${personId}`,
      {
        [`GET ${org}/people/${personId}`]: detail(),
        [`GET ${org}/tags`]: { items: [tag(morning, 3), tag(evening, 0)] },
        [`POST ${org}/people/${personId}/tags/${evening.id}`]: { items: [morning, evening] },
        [`DELETE ${org}/people/${personId}/tags/${morning.id}`]: { items: [] },
        [`GET ${org}/people/${personId}/notes`]: { items: [], nextBefore: null },
      },
      staff,
      "staff",
    );
    const section = await screen.findByRole("region", { name: "תגיות" });
    expect(within(section).getByText("בוקר")).toBeInTheDocument();

    await userEvent.selectOptions(await within(section).findByRole("combobox", { name: "הוספת תגית" }), "ערב");
    await userEvent.click(within(section).getByRole("button", { name: "הוספה" }));
    await waitFor(() => expect(sent(api, "POST", `/people/${personId}/tags/${evening.id}`)).toHaveLength(1));

    await userEvent.click(within(section).getByRole("button", { name: "הסרת התגית בוקר" }));
    await waitFor(() => expect(sent(api, "DELETE", `/people/${personId}/tags/${morning.id}`)).toHaveLength(1));
  });

  it("shows the tags, and no way to change them, without people.manage", async () => {
    const api = renderAt(
      `/o/neshima/people/${personId}`,
      { [`GET ${org}/people/${personId}`]: detail() },
      ["organization.view", "members.view", "people.view"],
      "staff",
    );
    const section = await screen.findByRole("region", { name: "תגיות" });
    expect(within(section).getByText("בוקר")).toBeInTheDocument();
    expect(within(section).queryByRole("combobox")).not.toBeInTheDocument();
    expect(within(section).queryByRole("button", { name: "הסרת התגית בוקר" })).not.toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "הערות צוות" })).not.toBeInTheDocument();
    expect(sent(api, "GET", `/people/${personId}/notes`)).toHaveLength(0);
  });
});

describe("staff notes on the person card", () => {
  const routesForNotes = {
    [`GET ${org}/people/${personId}`]: detail(),
    [`GET ${org}/tags`]: { items: [tag(morning, 3)] },
    [`GET ${org}/people/${personId}/notes`]: { items: [mine, theirs], nextBefore: null },
    [`POST ${org}/people/${personId}/notes`]: () => json(mine, 201),
    [`DELETE ${org}/people/${personId}/notes/${mine.id}`]: () => new Response(null, { status: 204 }),
  };

  it("lists notes newest first, says what never goes there and who gets them, and adds one", async () => {
    const api = renderAt(`/o/neshima/people/${personId}`, routesForNotes, staff, "staff");
    const section = await screen.findByRole("region", { name: "הערות צוות" });
    const list = await within(section).findByRole("list", { name: "הערות" });
    expect(within(list).getAllByRole("listitem").map((item) => item.textContent)).toEqual([
      expect.stringContaining("מעדיפה את השורה הראשונה"),
      expect.stringContaining("שילמה על כרטיסייה במזומן"),
    ]);
    // The author by name, or by role once the membership is gone.
    expect(within(list).getByText(/דנה כהן/)).toBeInTheDocument();
    expect(within(list).getByText(/בעלים/)).toBeInTheDocument();
    expect(within(section).getByText(/לא כותבים כאן מידע רפואי/)).toBeInTheDocument();
    expect(within(section).getByText(/מקבל אותה כשהוא מבקש עותק של הנתונים שלו/)).toBeInTheDocument();

    await userEvent.click(within(section).getByRole("button", { name: "שמירת ההערה" }));
    expect(within(section).getByText("כתבו את ההערה.")).toBeInTheDocument();
    expect(sent(api, "POST", `/people/${personId}/notes`)).toHaveLength(0);

    await userEvent.type(within(section).getByRole("textbox", { name: "הערה חדשה" }), "  מגיעה עם חברה  ");
    await userEvent.click(within(section).getByRole("button", { name: "שמירת ההערה" }));
    await waitFor(() => expect(sent(api, "POST", `/people/${personId}/notes`)).toHaveLength(1));
    const index = api.requests.indexOf(sent(api, "POST", `/people/${personId}/notes`)[0]!);
    expect(api.bodies[index]).toEqual({ body: "מגיעה עם חברה" });
  });

  it("lets staff delete their own note only, after a confirm", async () => {
    const api = renderAt(`/o/neshima/people/${personId}`, routesForNotes, staff, "staff");
    const list = await screen.findByRole("list", { name: "הערות" });
    const [own, other] = within(list).getAllByRole("listitem");
    expect(within(other!).queryByRole("button", { name: "מחיקה" })).not.toBeInTheDocument();

    await userEvent.click(within(own!).getByRole("button", { name: "מחיקה" }));
    const dialog = screen.getByRole("dialog", { name: "למחוק את ההערה?" });
    await userEvent.click(within(dialog).getByRole("button", { name: "מחיקת ההערה" }));
    await waitFor(() => expect(sent(api, "DELETE", `/people/${personId}/notes/${mine.id}`)).toHaveLength(1));
  });

  it("lets an owner (people.notes.moderate) delete anyone's note", async () => {
    renderAt(`/o/neshima/people/${personId}`, routesForNotes);
    const list = await screen.findByRole("list", { name: "הערות" });
    expect(within(list).getAllByRole("button", { name: "מחיקה" })).toHaveLength(2);
  });
});

describe("the studio's tags in the settings", () => {
  it("creates, renames with If-Match, and deletes with a confirm that counts the people", async () => {
    const api = renderAt("/o/neshima/settings", {
      [`GET ${org}/tags`]: { items: [tag(morning, 3, "7")] },
      [`POST ${org}/tags`]: () => json(tag({ ...evening, name: "ייבוא 17.10" }, 0), 201),
      [`PATCH ${org}/tags/${morning.id}`]: tag({ ...morning, name: "בוקר מוקדם" }, 3, "8"),
      [`DELETE ${org}/tags/${morning.id}`]: () => new Response(null, { status: 204 }),
    });
    const card = await screen.findByRole("region", { name: "תגיות" });
    expect(await within(card).findByText("3 אנשים")).toBeInTheDocument();

    await userEvent.click(within(card).getByRole("button", { name: "תגית חדשה" }));
    let dialog = screen.getByRole("dialog", { name: "תגית חדשה" });
    await userEvent.type(within(dialog).getByRole("textbox", { name: /שם/ }), "ייבוא 17.10");
    await userEvent.selectOptions(within(dialog).getByRole("combobox", { name: "צבע" }), "כחול");
    await userEvent.click(within(dialog).getByRole("button", { name: "שמירה" }));
    await waitFor(() => expect(sent(api, "POST", "/tags")).toHaveLength(1));
    expect(api.bodies[api.requests.indexOf(sent(api, "POST", "/tags")[0]!)]).toEqual({ name: "ייבוא 17.10", color: 4 });

    await userEvent.click(within(card).getByRole("button", { name: "עריכת התגית בוקר" }));
    dialog = screen.getByRole("dialog", { name: "עריכת תגית" });
    const name = within(dialog).getByRole("textbox", { name: /שם/ });
    await userEvent.clear(name);
    await userEvent.type(name, "בוקר מוקדם");
    await userEvent.click(within(dialog).getByRole("button", { name: "שמירה" }));
    await waitFor(() => expect(sent(api, "PATCH", `/tags/${morning.id}`)).toHaveLength(1));
    expect(sent(api, "PATCH", `/tags/${morning.id}`)[0]!.headers.get("If-Match")).toBe("7");

    await userEvent.click(within(card).getByRole("button", { name: "מחיקת התגית בוקר" }));
    dialog = screen.getByRole("dialog", { name: "למחוק את התגית בוקר?" });
    expect(dialog).toHaveTextContent("היא מסומנת אצל 3 אנשים, ותוסר מכולם.");
    await userEvent.click(within(dialog).getByRole("button", { name: "מחיקת התגית" }));
    await waitFor(() => expect(sent(api, "DELETE", `/tags/${morning.id}`)).toHaveLength(1));
  });
});

describe("tags on the people list", () => {
  it("shows each person's tags and filters the list by one, kept in the address", async () => {
    const api = renderAt("/o/neshima/people", {
      [`GET ${org}/people`]: { items: [person([morning])], nextBefore: null },
      [`GET ${org}/tags`]: { items: [tag(morning, 1), tag(evening, 0)] },
    });
    const table = await screen.findByRole("table", { name: "אנשים" });
    expect(within(within(table).getAllByRole("row")[1]!).getByText("בוקר")).toBeInTheDocument();

    await userEvent.selectOptions(await screen.findByRole("combobox", { name: "סינון לפי תגית" }), "ערב");
    await waitFor(() =>
      expect(api.requests.some((request) => new URL(request.url).searchParams.get("tag") === evening.id)).toBe(true),
    );
  });

  it("opens filtered when the address names a tag", async () => {
    const api = renderAt(`/o/neshima/people?tag=${morning.id}`, {
      [`GET ${org}/people`]: { items: [person([morning])], nextBefore: null },
      [`GET ${org}/tags`]: { items: [tag(morning, 1)] },
    });
    expect(await screen.findByRole("combobox", { name: "סינון לפי תגית" })).toHaveValue(morning.id);
    expect(
      api.requests.some(
        (request) => request.url.includes("/people?") && new URL(request.url).searchParams.get("tag") === morning.id,
      ),
    ).toBe(true);
  });
});
