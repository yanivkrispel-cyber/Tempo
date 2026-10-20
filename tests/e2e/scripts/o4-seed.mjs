// Seeds the smoke studio for the O4 run and writes ./o4-state.json (no secrets); `--cleanup` undoes it.
import { readFileSync, writeFileSync } from "node:fs";
import { call, smokeToken, localAt, e2eUsers, deleteUser } from "./o4-lib.mjs";

const STATE = process.env.O4_STATE;
const smoke = smokeToken();
const me = (await call(smoke, "GET", "/api/v1/me")).json;
const studio = me.memberships.find((m) => m.role === "owner" && m.permissions.includes("marketing.publish"));
const s = `/api/v1/organizations/${studio.organization.id}`;
const slug = studio.organization.slug;

if (process.argv.includes("--cleanup")) {
  const st = JSON.parse(readFileSync(STATE, "utf8"));
  const cur = (await call(smoke, "GET", `${s}/public-page`)).json;
  await call(smoke, "PUT", `${s}/public-page`, st.pageBefore, { ifMatch: cur.version });
  for (const id of st.sessions) await call(smoke, "POST", `${s}/sessions/${id}/cancel`);
  for (const id of st.products) await call(smoke, "POST", `${s}/pass-products/${id}/archive`);
  for (const pid of st.people ?? [])
    await call(smoke, "POST", `${s}/people/${pid}/erase`, { reason: "e2e o4 phone run" });
  // Every member this run made: erased and removed from the studio, then the Cognito user deleted.
  for (const email of e2eUsers()) {
    const found = (await call(smoke, "GET", `${s}/people?query=${encodeURIComponent(email)}`)).json?.items?.[0];
    if (found) {
      await call(smoke, "POST", `${s}/people/${found.id}/erase`, { reason: "e2e o4 phone run" });
      if (found.membershipId) await call(smoke, "DELETE", `${s}/members/${found.membershipId}`);
    }
    deleteUser(email);
  }
  console.log("cleaned: page restored, classes cancelled, products archived, people erased");
  process.exit(0);
}

const pageBefore = (await call(smoke, "GET", `${s}/public-page`)).json;
const offer = (
  await call(smoke, "POST", `${s}/pass-products`, {
    kind: "punch_card",
    name: "e2e-o4 3 שיעורי ניסיון",
    entries: 3,
    validDays: 35,
    priceAgorot: 9900,
  })
).json;
const intro = (
  await call(smoke, "POST", `${s}/pass-products`, {
    kind: "punch_card",
    name: "e2e-o4 שיעור ניסיון",
    entries: 12,
    validDays: 7,
    priceAgorot: 0,
  })
).json;
const cur = pageBefore;
const listed = [
  ...(cur.listedProducts ?? []),
  { productId: offer.id, newcomersOnly: true, publicUntil: null, blurb: "בדיקה" },
];
const page = await call(
  smoke,
  "PUT",
  `${s}/public-page`,
  { ...cur, enabled: true, openJoin: true, introProductId: intro.id, listedProducts: listed },
  { ifMatch: cur.version },
);
console.log("page", page.status);
const types = (await call(smoke, "GET", `${s}/class-types`)).json.items.filter((t) => t.status === "active");
const mk = async (minutes, extra = {}) =>
  (
    await call(smoke, "POST", `${s}/sessions`, {
      classTypeId: types[0].id,
      ...localAt(new Date(Date.now() + minutes * 60_000)),
      minutes: 30,
      capacity: 30,
      ...extra,
    })
  ).json;
const cls = await mk(2 * 24 * 60 + 7);
const alt = await mk(2 * 24 * 60 + 187);
const full = await mk(2 * 24 * 60 + 97, { capacity: 1 });
const link = async (kind, id) =>
  (await call(smoke, "POST", `${s}/marketing/links`, { channel: "story", template: "week", target: { kind, id } }))
    .json;
const links = {
  session: await link("session", cls.id),
  offer: await link("offer", offer.id),
  prices: await link("prices", null),
  fullSession: await link("session", full.id),
};
// Fill the one-place class with a staff-made person, so it is full signed out.
const person = (
  await call(smoke, "POST", `${s}/people`, {
    displayName: "e2e-o4 מלא",
    email: `e2e-o4-filler-${Date.now().toString(36)}@example.com`,
  })
).json;
const card = (
  await call(smoke, "POST", `${s}/pass-products`, {
    kind: "punch_card",
    name: "e2e-o4 filler",
    entries: 3,
    validDays: 7,
    priceAgorot: 0,
  })
).json;
const fp = (await call(smoke, "POST", `${s}/people/${person.id}/passes`, { productId: card.id, note: "e2e" })).status;
console.log("grant", fp);
const fill = await call(smoke, "POST", `${s}/sessions/${full.id}/bookings`, { personId: person?.id });
console.log("fill booking", fill.status, JSON.stringify(fill.json)?.slice(0, 120));
const pub = (await call(null, "GET", `/api/v1/public/studios/${slug}/sessions/${full.id}`)).json;
console.log("full availability", pub?.availability, "alts", pub?.alternatives?.length);
writeFileSync(
  STATE,
  JSON.stringify(
    {
      slug,
      orgId: studio.organization.id,
      pageBefore,
      products: [offer.id, card.id, intro.id],
      sessions: [cls.id, alt.id, full.id],
      people: person?.id ? [person.id] : [],
      cls: cls.id,
      full: full.id,
      offer: offer.id,
      urls: Object.fromEntries(Object.entries(links).map(([k, v]) => [k, v.url])),
      codes: Object.fromEntries(Object.entries(links).map(([k, v]) => [k, v.code])),
      linkIds: Object.fromEntries(Object.entries(links).map(([k, v]) => [k, v.id])),
    },
    null,
    1,
  ),
);
console.log(Object.values(links).map((l) => l.url.replace(/src=.*/, "src=…")));
