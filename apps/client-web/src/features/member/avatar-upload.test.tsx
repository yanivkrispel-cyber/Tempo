import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import { App } from "../../app/App";
import { routes } from "../../app/routes";
import { apiStub } from "../../test/api";
import { signedInAuth } from "../../test/auth";
import { createStudio, organizationId, testNow } from "../../test/studio";

// The member's picture goes to storage as a presigned POST (H-1, board #347): S3 itself refuses a file over 8 MB.
// Every field of the ticket goes as given, the file last; S3's refusal reads in Hebrew.
const base = `/api/v1/organizations/${organizationId}`;
const personId = "0199e5a1-0000-7000-8000-0000000b0001";
const mediaId = "0199e5a1-0000-7000-8000-0000000b0099";
const ticket = {
  mediaId,
  uploadUrl: "https://storage.test/put-is-gone",
  uploadForm: {
    url: "https://storage.test/tempo-media",
    fields: { key: `uploads/${mediaId}`, "Content-Type": "image/jpeg", Policy: "cG9saWN5", "X-Amz-Signature": "abc" },
  },
  maxBytes: 8 * 1024 * 1024,
  contentType: "image/jpeg",
  expiresAt: "2026-10-18T20:00:00Z",
};
const media = {
  id: mediaId,
  purpose: "avatar",
  ownerId: personId,
  url: "https://media.test/me.webp",
  smallUrl: "https://media.test/me-small.webp",
  width: 512,
  height: 512,
};

function renderProfile() {
  const studio = createStudio();
  const api = apiStub({
    ...studio.routes,
    [`GET ${base}/me/profile`]: { id: personId, avatarUrl: null, consents: [] },
    [`POST ${base}/media/uploads`]: ticket,
    [`POST ${base}/media/uploads/${mediaId}/finalize`]: media,
  });
  render(
    <App
      router={createMemoryRouter(routes, { initialEntries: ["/profile"] })}
      auth={signedInAuth()}
      apiUrl="https://api.test"
      fetch={api.fetch}
      now={testNow}
    />,
  );
  return api;
}

async function pick() {
  const label = await screen.findByLabelText("החלפת התמונה שלי");
  const input = label.querySelector<HTMLInputElement>('input[type="file"]') ?? (label as HTMLInputElement);
  await userEvent.upload(input, new File([new Uint8Array([255, 216, 255])], "me.jpg", { type: "image/jpeg" }));
}

afterEach(() => vi.unstubAllGlobals());

describe("the member's picture goes to storage as a presigned POST", () => {
  it("sends every field as given and the file last, then finalizes", async () => {
    const storage = vi.fn<typeof fetch>(async () => new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", storage);
    const api = renderProfile();
    await pick();

    expect(await screen.findByText("התמונה עודכנה")).toBeInTheDocument();
    const [url, init] = storage.mock.calls[0]!;
    expect(url).toBe(ticket.uploadForm.url);
    expect(init?.method).toBe("POST");
    const form = init!.body as FormData;
    expect([...form.keys()]).toEqual([...Object.keys(ticket.uploadForm.fields), "file"]);
    expect(form.get("Policy")).toBe("cG9saWN5");
    expect(api.requests.some((request) => request.url.endsWith(`/media/uploads/${mediaId}/finalize`))).toBe(true);
  });

  it("reads S3's EntityTooLarge in Hebrew", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>(async () => new Response("<Error><Code>EntityTooLarge</Code></Error>", { status: 400 })),
    );
    const api = renderProfile();
    await pick();

    expect(await screen.findByText("התמונה גדולה מ-8 מגה. נסו תמונה קטנה יותר.")).toBeInTheDocument();
    expect(api.requests.some((request) => request.url.includes("/finalize"))).toBe(false);
  });
});
