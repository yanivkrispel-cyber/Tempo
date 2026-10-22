// Tempo's service worker: web push only (docs/30 section 4.3). No caching, no fetch handler.
//
// The push payload carries ids, the class's name and start for class notices, and since docs/30 step 7 the title and
// plain body rendered from the studio's template. Without those (older payloads, and announcements, whose text stays
// in the inbox) the text is written here per kind. Keep the kinds in step with InboxScreen.tsx.

/* global self */

const titles = {
  "booking.promoted": "התפנה מקום ונרשמת",
  "booking.promotion_failed": "התפנה מקום, אבל אין כרטיסייה בתוקף",
  "booking.moved": "הסטודיו העביר אותך לשיעור אחר",
  "session.cancelled": "הסטודיו ביטל שיעור",
  "session.message": "הודעה מהסטודיו על השיעור",
  "waitlist.expired": "לא התפנה מקום",
  "pass.frozen": "המנוי הוקפא",
  "reminder.class_tomorrow": "תזכורת: יש לך שיעור מחר",
  "reminder.class_soon": "תזכורת: השיעור מתחיל בקרוב",
  "reminder.pass_ending": "המנוי או הכרטיסייה עומדים לפוג",
  "reminder.entries_low": "נשארו מעט כניסות בכרטיסייה",
  "studio.announcement": "הודעה חדשה מהסטודיו",
  "member.milestone": "הגעת לאבן דרך",
  "member.referral_rewarded": "חברה שהזמנת הגיעה לשיעור הראשון",
};

const passBodies = {
  "pass.frozen": "הפרטים בתיבת ההודעות באפליקציה.",
  "reminder.pass_ending": "כדי להמשיך להירשם לשיעורים, פנו לסטודיו לחידוש.",
  "reminder.entries_low": "כדי להמשיך להירשם לשיעורים, פנו לסטודיו לכרטיסייה חדשה.",
  "studio.announcement": "הפרטים בתיבת ההודעות באפליקציה.",
  "member.milestone": "הכרטיס שלך מוכן באפליקציה.",
  "member.referral_rewarded": "קיבלת כרטיסייה מהסטודיו.",
};

const text = (value) => (typeof value === "string" && value.trim() ? value.trim() : null);

function classLine(session) {
  if (!session || !session.classTypeName) return "";
  const startsAt = new Date(session.startsAt);
  if (Number.isNaN(startsAt.getTime())) return session.classTypeName;
  const when = new Intl.DateTimeFormat("he-IL", {
    weekday: "long",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(startsAt);
  return `${session.classTypeName}, ${when}`;
}

/** What a push shows, or null for a kind this version does not know (it stays in the inbox). */
function notice(payload) {
  if (!payload || typeof payload !== "object" || !(payload.kind in titles)) return null;
  const data = payload.data || {};
  const params = new URLSearchParams();
  if (payload.organizationId) params.set("studio", payload.organizationId);
  if (payload.inboxItemId) params.set("notification", payload.inboxItemId);
  const path = data.sessionId ? `/classes/${encodeURIComponent(data.sessionId)}` : "/inbox";
  return {
    title: text(payload.title) || titles[payload.kind],
    options: {
      body: text(payload.body) || passBodies[payload.kind] || classLine(payload.session),
      dir: "rtl",
      lang: "he",
      tag: payload.inboxItemId || undefined,
      data: { url: `${path}?${params}` },
    },
  };
}

self.tempoNotice = notice;

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

self.addEventListener("push", (event) => {
  let payload = null;
  try {
    payload = event.data ? event.data.json() : null;
  } catch {
    payload = null;
  }
  const shown = notice(payload);
  if (shown) event.waitUntil(self.registration.showNotification(shown.title, shown.options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = new URL((event.notification.data && event.notification.data.url) || "/inbox", self.location.origin);
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((windows) => {
      const open = windows.find((client) => new URL(client.url).origin === url.origin);
      if (open) return open.navigate(url.href).then((client) => (client || open).focus());
      return self.clients.openWindow(url.href);
    }),
  );
});
