import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import { App } from "../../app/App";
import { routes } from "../../app/routes";
import { apiStub, sampleMe } from "../../test/api";
import { signedInAuth } from "../../test/auth";
import { permissionsFor } from "../../test/permissions";

// The picture goes to storage as a presigned POST (H-1, board #347): S3 itself refuses a file over 8 MB, which a
// presigned PUT cannot. Every field of the ticket goes as given, the file last; S3's refusal reads in Hebrew.
const studio = sampleMe.memberships[0]!;
const base = `/api/v1/organizations/${studio.organization.id}`;
const classType = {
  id: "0199e5a1-0000-7000-8000-0000000a0001",
  name: "פילאטיס מכשירים",
  category: "pilates",
  color: "rose",
  defaultMinutes: 50,
  description: null,
  status: "active",
  version: "1",
};
const mediaId = "0199e5a1-0000-7000-8000-0000000a0099";
const ticket = {
  mediaId,
  uploadUrl: "https://storage.test/put-is-gone",
  uploadForm: {
    url: "https://storage.test/tempo-media",
    fields: { key: `uploads/${mediaId}`, "Content-Type": "image/png", Policy: "cG9saWN5", "X-Amz-Signature": "abc" },
  },
  maxBytes: 8 * 1024 * 1024,
  contentType: "image/png",
  expiresAt: "2026-10-18T20:00:00Z",
};
const media = {
  id: mediaId,
  purpose: "class_cover",
  ownerId: classType.id,
  url: "https://media.test/cover.webp",
  smallUrl: "https://media.test/cover-small.webp",
  width: 1600,
  height: 900,
};

function renderClassTypes() {
  const api = apiStub({
    "POST /api/v1/session": {
      ...sampleMe,
      memberships: [{ ...studio, role: "owner", roles: [], permissions: permissionsFor.owner }],
    },
    [`GET ${base}/class-types`]: { items: [classType] },
    [`POST ${base}/media/uploads`]: ticket,
    [`POST ${base}/media/uploads/${mediaId}/finalize`]: media,
  });
  render(
    <App
      router={createMemoryRouter(routes, { initialEntries: ["/o/neshima/class-types"] })}
      auth={signedInAuth()}
      apiUrl="https://api.test"
      fetch={api.fetch}
    />,
  );
  return api;
}

async function uploadCover(file: File) {
  await userEvent.click(await screen.findByRole("button", { name: `עריכת ${classType.name}` }));
  const dialog = screen.getByRole("dialog", { name: "עריכת סוג שיעור" });
  const input = dialog.querySelector<HTMLInputElement>('input[type="file"]')!;
  await userEvent.upload(input, file);
  return dialog;
}

const png = () => new File([new Uint8Array([137, 80, 78, 71])], "cover.png", { type: "image/png" });

afterEach(() => vi.unstubAllGlobals());

describe("a class cover goes to storage as a presigned POST", () => {
  it("sends every field as given and the file last, then finalizes", async () => {
    const storage = vi.fn<typeof fetch>(async () => new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", storage);
    const api = renderClassTypes();
    const dialog = await uploadCover(png());

    await waitFor(() => expect(dialog.querySelector("img")).toHaveAttribute("src", media.smallUrl));
    expect(storage).toHaveBeenCalledOnce();
    const [url, init] = storage.mock.calls[0]!;
    expect(url).toBe(ticket.uploadForm.url);
    expect(init?.method).toBe("POST");
    const form = init!.body as FormData;
    expect([...form.keys()]).toEqual([...Object.keys(ticket.uploadForm.fields), "file"]);
    for (const [name, value] of Object.entries(ticket.uploadForm.fields)) expect(form.get(name)).toBe(value);
    expect((form.get("file") as File).name).toBe("cover.png");
    expect(api.requests.some((request) => request.url.endsWith(`/media/uploads/${mediaId}/finalize`))).toBe(true);
  });

  it("reads S3's EntityTooLarge in Hebrew and does not finalize", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>(
        async () =>
          new Response(
            "<Error><Code>EntityTooLarge</Code><Message>Your proposed upload exceeds the maximum allowed size</Message></Error>",
            {
              status: 400,
              headers: { "content-type": "application/xml" },
            },
          ),
      ),
    );
    const api = renderClassTypes();
    const dialog = await uploadCover(png());

    expect(await within(dialog).findByText("התמונה גדולה מדי. אפשר עד 8 מגה.")).toBeInTheDocument();
    expect(api.requests.some((request) => request.url.includes("/finalize"))).toBe(false);
  });

  it("says the upload failed when storage refuses for another reason", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>(async () => new Response("<Error><Code>AccessDenied</Code></Error>", { status: 403 })),
    );
    renderClassTypes();
    const dialog = await uploadCover(png());
    expect(await within(dialog).findByText("לא הצלחנו להעלות את התמונה. נסו שוב.")).toBeInTheDocument();
  });
});
