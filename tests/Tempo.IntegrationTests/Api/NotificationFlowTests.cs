using System.Globalization;
using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Security.Claims;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using FluentAssertions;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.IdentityModel.JsonWebTokens;
using Microsoft.IdentityModel.Protocols.OpenIdConnect;
using Microsoft.IdentityModel.Tokens;
using Tempo.Api.DependencyInjection;
using Tempo.IntegrationTests.DatabaseMigrator;
using Tempo.Platform.BuildingBlocks.Persistence;
using Tempo.Platform.Modules.Identity.Application;
using Tempo.Platform.Modules.Notifications.Application;
using Tempo.Platform.Modules.Notifications.Infrastructure;
using Xunit;

namespace Tempo.IntegrationTests.Api;

/// <summary>
/// Notification preferences, studio settings and the inbox-only delivery pipeline (docs/30 sections 7 and 8; day
/// board #176, P3) through the real API host and a migrated PostgreSQL 18: every inbox item now has a request and
/// an inbox delivery, the deliver job routes push with the member's choices, nothing leaves the app, a second run
/// does nothing, and erasing the member removes their notification rows.
/// </summary>
public sealed class NotificationFlowTests(PostgresFixture postgres) : IClassFixture<PostgresFixture>, IDisposable
{
    private const string CustomerIssuer = "https://cognito-idp.eu-central-1.amazonaws.com/eu-central-1_Customers";

    private readonly RSA rsa = RSA.Create(2048);

    public void Dispose() => rsa.Dispose();

    [Fact]
    public async Task Preferences_Settings_AndTheInboxOnlyRouter()
    {
        await using var db = await MigratedDatabase.CreateAsync(postgres);
        using var factory = Factory(db);
        var client = factory.CreateClient();
        var israel = TimeZoneInfo.FindSystemTimeZoneById("Asia/Jerusalem");
        var today = DateOnly.FromDateTime(TimeZoneInfo.ConvertTime(DateTimeOffset.UtcNow, israel).DateTime);

        await SendAsync(client, HttpMethod.Post, "/api/v1/session", Customer("owner"));
        var studio = await SendAsync(client, HttpMethod.Post, "/api/v1/organizations", Customer("owner"), new { displayName = "סטודיו גל", slug = "studio-gal" }, HttpStatusCode.Created);
        var studioPath = $"/api/v1/organizations/{studio.GetProperty("id").GetGuid()}";
        var dana = await JoinByInvitationAsync(client, studioPath, "dana", "staff");
        foreach (var member in new[] { "noga", "rina" })
        {
            await JoinByInvitationAsync(client, studioPath, member, "client");
        }

        // 1. Defaults: every group on inbox and push, no own quiet hours, the studio's 22:00 to 08:00.
        var mine = await SendAsync(client, HttpMethod.Get, $"{studioPath}/me/notification-preferences", Customer("noga"));
        mine.GetProperty("groups").EnumerateArray().Select(g => g.GetProperty("channels").GetProperty("push").GetBoolean()).Should().Equal(true, true, true);
        mine.GetProperty("quietHours").ValueKind.Should().Be(JsonValueKind.Null);
        mine.GetProperty("studioQuietHours").GetProperty("startsLocal").GetString().Should().Be("22:00");
        mine.GetProperty("timeZone").GetString().Should().Be("Asia/Jerusalem");
        mine.GetProperty("version").GetString().Should().Be("0");

        // 2. Rina turns push off for her bookings and sets her own quiet hours; the inbox cannot go off.
        var choice = new
        {
            groups = new[] { new { group = "bookings", channels = new { inbox = true, push = false } } },
            reminders = new { classTomorrow = true, classSoon = false, passEnding = true, entriesLow = true },
            quietHours = new { startsLocal = "23:00", endsLocal = "07:00" }
        };
        var saved = await SendAsync(client, HttpMethod.Put, $"{studioPath}/me/notification-preferences", Customer("rina"), choice, ifMatch: "0");
        saved.GetProperty("version").GetString().Should().Be("1");
        saved.GetProperty("groups")[0].GetProperty("channels").GetProperty("push").GetBoolean().Should().BeFalse();
        saved.GetProperty("reminders").GetProperty("classSoon").GetBoolean().Should().BeFalse();
        saved.GetProperty("quietHours").GetProperty("endsLocal").GetString().Should().Be("07:00");
        (await RawAsync(client, HttpMethod.Put, $"{studioPath}/me/notification-preferences", Customer("rina"), choice, ifMatch: "0")).StatusCode.Should().Be(HttpStatusCode.Conflict);
        await ProblemAsync(client, $"{studioPath}/me/notification-preferences", "rina", new
        {
            groups = new[] { new { group = "studio", channels = new { inbox = false, push = true } } },
            choice.reminders,
            quietHours = (object?)null
        }, "preferences.inbox_required");
        await ProblemAsync(client, $"{studioPath}/me/notification-preferences", "rina", new
        {
            choice.groups,
            choice.reminders,
            quietHours = new { startsLocal = "07:00", endsLocal = "07:00" }
        }, "quietHours.invalid");

        // 3. Studio settings: members read them, only settings managers change them.
        var settings = await SendAsync(client, HttpMethod.Get, $"{studioPath}/notification-settings", Customer("noga"));
        settings.GetProperty("reminders").GetProperty("classSoon").GetProperty("hoursBefore").GetInt32().Should().Be(2);
        settings.GetProperty("reminders").GetProperty("classTomorrow").GetProperty("sendAtLocal").GetString().Should().Be("18:00");
        var studioChoice = new
        {
            quietHours = new { startsLocal = "21:30", endsLocal = "08:00" },
            reminders = new
            {
                classTomorrow = new { enabled = true, sendAtLocal = "19:00" },
                classSoon = new { enabled = true, hoursBefore = 3 },
                passEnding = new { enabled = false, daysBefore = 7 },
                entriesLow = new { enabled = true, entriesLeft = 1 }
            }
        };
        (await RawAsync(client, HttpMethod.Put, $"{studioPath}/notification-settings", Customer("noga"), studioChoice)).StatusCode.Should().Be(HttpStatusCode.Forbidden);
        var changed = await SendAsync(client, HttpMethod.Put, $"{studioPath}/notification-settings", Customer("owner"), studioChoice, ifMatch: "0");
        changed.GetProperty("version").GetString().Should().Be("1");
        changed.GetProperty("quietHours").GetProperty("startsLocal").GetString().Should().Be("21:30");
        (await SendAsync(client, HttpMethod.Get, $"{studioPath}/me/notification-preferences", Customer("noga"))).GetProperty("studioReminders").GetProperty("passEnding").GetBoolean().Should().BeFalse();
        (await RawAsync(client, HttpMethod.Put, $"{studioPath}/notification-settings", Customer("owner"), new
        {
            studioChoice.quietHours,
            reminders = new { studioChoice.reminders.classTomorrow, classSoon = new { enabled = true, hoursBefore = 13 }, studioChoice.reminders.passEnding, studioChoice.reminders.entriesLow }
        })).StatusCode.Should().Be(HttpStatusCode.BadRequest);

        // 4. A one-place class: Noga books, Rina waits, Noga cancels and Rina is promoted; the instructor messages the class.
        var room = await SendAsync(client, HttpMethod.Post, $"{studioPath}/rooms", Customer("owner"), new { name = "חדר קטן", defaultCapacity = 1 }, HttpStatusCode.Created);
        var yoga = await SendAsync(client, HttpMethod.Post, $"{studioPath}/class-types", Customer("owner"), new { name = "יוגה", category = "yoga", color = "sage", defaultMinutes = 60 }, HttpStatusCode.Created);
        var session = await SendAsync(client, HttpMethod.Post, $"{studioPath}/sessions", Customer("owner"), new
        {
            classTypeId = yoga.GetProperty("id").GetGuid(),
            localDate = today.AddDays(3).ToString("yyyy-MM-dd", CultureInfo.InvariantCulture),
            localStart = "18:00",
            instructorMembershipId = dana,
            roomId = room.GetProperty("id").GetGuid(),
            capacity = 1
        }, HttpStatusCode.Created);
        var sessionPath = $"{studioPath}/sessions/{session.GetProperty("id").GetGuid()}";
        var card = await SendAsync(client, HttpMethod.Post, $"{studioPath}/pass-products", Customer("owner"), new { kind = "punch_card", name = "כרטיסייה", entries = 5, validDays = 60 }, HttpStatusCode.Created);
        var people = new Dictionary<string, Guid>();
        foreach (var member in new[] { "noga", "rina" })
        {
            people[member] = (await SendAsync(client, HttpMethod.Get, $"{studioPath}/people?query={member}@example.com", Customer("owner"))).GetProperty("items")[0].GetProperty("id").GetGuid();
            await SendAsync(client, HttpMethod.Post, $"{studioPath}/people/{people[member]}/passes", Customer("owner"), new { productId = card.GetProperty("id").GetGuid() }, HttpStatusCode.Created);
        }

        var noga = await SendAsync(client, HttpMethod.Post, $"{sessionPath}/bookings", Customer("noga"), null, HttpStatusCode.Created);
        var rina = await SendAsync(client, HttpMethod.Post, $"{sessionPath}/bookings", Customer("rina"), null, HttpStatusCode.Created);
        await SendAsync(client, HttpMethod.Post, $"{studioPath}/bookings/{noga.GetProperty("id").GetGuid()}/cancel", Customer("noga"));
        await SendAsync(client, HttpMethod.Post, $"{sessionPath}/messages", Customer("dana"), new { text = "מביאים מגבת" }, HttpStatusCode.Accepted);

        // 5. The inbox reads as before; each item has its request, keyed by kind, subject, person and the item.
        var inbox = await SendAsync(client, HttpMethod.Get, $"{studioPath}/me/notifications", Customer("rina"));
        inbox.GetProperty("items").EnumerateArray().Select(i => i.GetProperty("kind").GetString()).Should().BeEquivalentTo("session.message", "booking.promoted");
        var promotion = inbox.GetProperty("items").EnumerateArray().Single(i => i.GetProperty("kind").GetString() == "booking.promoted").GetProperty("id").GetGuid();
        (await db.AsMasterAsync("SELECT r.dedupe_key FROM notifications.requests r JOIN notifications.inbox_items i ON i.request_id = r.id WHERE i.id = $1", promotion))
            .Should().Be($"booking.promoted:{rina.GetProperty("id").GetGuid()}:{people["rina"]}:{promotion}");
        (await db.AsMasterAsync("SELECT count(*) FROM notifications.inbox_items WHERE request_id IS NULL")).Should().Be(0L);
        (await db.AsMasterAsync("SELECT count(*) FROM notifications.deliveries WHERE channel = 'inbox' AND status = 'delivered'")).Should().Be(2L);

        // 6. The deliver job: Rina switched push off for bookings; the class message has no device to go to.
        var job = new NotificationDeliveryJob(db, TimeProvider.System);
        (await job.RunAsync(CancellationToken.None)).Should().Be(new DeliveryRun(2, 2, 0, 0, 0, 0));
        (await db.AsMasterAsync("SELECT string_agg(r.kind || '=' || d.skip_reason, ',' ORDER BY r.kind) FROM notifications.deliveries d JOIN notifications.requests r ON r.id = d.request_id WHERE d.channel = 'push'"))
            .Should().Be("booking.promoted=preference_off,session.message=no_subscription");
        (await job.RunAsync(CancellationToken.None)).Should().Be(new DeliveryRun(0, 0, 0, 0, 0, 0), "one push line per request");

        // 7. Erasing Rina takes her preferences, requests and deliveries with her; the studio's settings stay.
        await SendAsync(client, HttpMethod.Post, $"{studioPath}/people/{people["rina"]}/erase", Customer("owner", freshSignIn: true), new { reason = "בקשת מחיקה" });
        foreach (var table in new[] { "preferences", "quiet_hours", "reminder_switches", "preference_versions", "requests" })
        {
            (await db.AsMasterAsync($"SELECT count(*) FROM notifications.{table} WHERE person_id = $1", people["rina"])).Should().Be(0L, table);
        }

        (await db.AsMasterAsync("SELECT count(*) FROM notifications.deliveries")).Should().Be(0L);
        (await db.AsMasterAsync("SELECT count(*) FROM notifications.studio_settings")).Should().Be(1L);
    }

    [Fact]
    public async Task Devices_Subscribe_GetTheirPush_AndGoneOnesAreRemoved()
    {
        await using var db = await MigratedDatabase.CreateAsync(postgres);
        using (var noKeys = Factory(db))
        {
            await SendAsync(noKeys.CreateClient(), HttpMethod.Post, "/api/v1/session", Customer("owner"));
            (await RawAsync(noKeys.CreateClient(), HttpMethod.Get, "/api/v1/push/vapid-public-key", Customer("owner"))).StatusCode.Should().Be(HttpStatusCode.NotFound, "no key pair yet");
        }

        using var factory = Factory(db, BrowserKey);
        var client = factory.CreateClient();
        (await SendAsync(client, HttpMethod.Get, "/api/v1/push/vapid-public-key", Customer("owner"))).GetProperty("publicKey").GetString().Should().Be(BrowserKey);
        var today = DateOnly.FromDateTime(TimeZoneInfo.ConvertTime(DateTimeOffset.UtcNow, TimeZoneInfo.FindSystemTimeZoneById("Asia/Jerusalem")).DateTime);
        var studio = await SendAsync(client, HttpMethod.Post, "/api/v1/organizations", Customer("owner"), new { displayName = "סטודיו ים", slug = "studio-yam" }, HttpStatusCode.Created);
        var studioPath = $"/api/v1/organizations/{studio.GetProperty("id").GetGuid()}";
        var dana = await JoinByInvitationAsync(client, studioPath, "dana", "staff");
        foreach (var member in new[] { "noga", "rina" })
        {
            await JoinByInvitationAsync(client, studioPath, member, "client");
        }

        // 1. Rina's phone and laptop subscribe; the same endpoint again is the same device; made-up addresses are refused.
        var phone = new { endpoint = "https://fcm.googleapis.com/fcm/send/rina-phone", keys = new { p256dh = BrowserKey, auth = BrowserAuth }, deviceLabel = "Chrome, Android" };
        var created = await SendAsync(client, HttpMethod.Post, $"{studioPath}/me/push-subscriptions", Customer("rina"), phone, HttpStatusCode.Created);
        (await SendAsync(client, HttpMethod.Post, $"{studioPath}/me/push-subscriptions", Customer("rina"), phone)).GetProperty("id").GetGuid().Should().Be(created.GetProperty("id").GetGuid());
        created.TryGetProperty("endpoint", out _).Should().BeFalse("the endpoint is never sent back");
        await ProblemAsync(client, HttpMethod.Post, $"{studioPath}/me/push-subscriptions", "rina", new { endpoint = "https://push.example.com/x", phone.keys, phone.deviceLabel }, "push.endpoint_invalid");
        await ProblemAsync(client, HttpMethod.Post, $"{studioPath}/me/push-subscriptions", "rina", new { phone.endpoint, keys = new { p256dh = "AAAA", auth = BrowserAuth }, phone.deviceLabel }, "push.keys_invalid");
        await SendAsync(client, HttpMethod.Post, $"{studioPath}/me/push-subscriptions", Customer("rina"), new
        {
            endpoint = "https://updates.push.services.mozilla.com/wpush/v2/rina-laptop",
            phone.keys,
            deviceLabel = "Firefox, Windows"
        }, HttpStatusCode.Created);
        (await SendAsync(client, HttpMethod.Get, $"{studioPath}/me/push-subscriptions", Customer("rina"))).GetProperty("items").GetArrayLength().Should().Be(2);
        (await SendAsync(client, HttpMethod.Get, $"{studioPath}/me/push-subscriptions", Customer("noga"))).GetProperty("items").GetArrayLength().Should().Be(0);

        // 2. Rina is promoted into a one-place class and the instructor messages it.
        var room = await SendAsync(client, HttpMethod.Post, $"{studioPath}/rooms", Customer("owner"), new { name = "חדר", defaultCapacity = 1 }, HttpStatusCode.Created);
        var yoga = await SendAsync(client, HttpMethod.Post, $"{studioPath}/class-types", Customer("owner"), new { name = "יוגה", category = "yoga", color = "sage", defaultMinutes = 60 }, HttpStatusCode.Created);
        var session = await SendAsync(client, HttpMethod.Post, $"{studioPath}/sessions", Customer("owner"), new
        {
            classTypeId = yoga.GetProperty("id").GetGuid(),
            localDate = today.AddDays(3).ToString("yyyy-MM-dd", CultureInfo.InvariantCulture),
            localStart = "12:00",
            instructorMembershipId = dana,
            roomId = room.GetProperty("id").GetGuid(),
            capacity = 1
        }, HttpStatusCode.Created);
        var sessionPath = $"{studioPath}/sessions/{session.GetProperty("id").GetGuid()}";
        var card = await SendAsync(client, HttpMethod.Post, $"{studioPath}/pass-products", Customer("owner"), new { kind = "punch_card", name = "כרטיסייה", entries = 5, validDays = 60 }, HttpStatusCode.Created);
        foreach (var member in new[] { "noga", "rina" })
        {
            var person = (await SendAsync(client, HttpMethod.Get, $"{studioPath}/people?query={member}@example.com", Customer("owner"))).GetProperty("items")[0].GetProperty("id").GetGuid();
            await SendAsync(client, HttpMethod.Post, $"{studioPath}/people/{person}/passes", Customer("owner"), new { productId = card.GetProperty("id").GetGuid() }, HttpStatusCode.Created);
        }

        var noga = await SendAsync(client, HttpMethod.Post, $"{sessionPath}/bookings", Customer("noga"), null, HttpStatusCode.Created);
        await SendAsync(client, HttpMethod.Post, $"{sessionPath}/bookings", Customer("rina"), null, HttpStatusCode.Created);
        await SendAsync(client, HttpMethod.Post, $"{studioPath}/bookings/{noga.GetProperty("id").GetGuid()}/cancel", Customer("noga"));

        // 3. The phone takes the promotion, the laptop is gone: the line is accepted and the laptop removed. Run at
        //    noon studio time so quiet hours do not hold it.
        var noon = new FakeClock(new DateTimeOffset(DateTime.SpecifyKind(DateTime.UtcNow.Date.AddHours(10), DateTimeKind.Utc)));
        var push = new ScriptedPush(PushOutcome.Accepted, goneHost: "updates.push.services.mozilla.com");
        var run = await new NotificationDeliveryJob(db, noon, _ => Task.FromResult<IPushSender?>(push)).RunAsync(CancellationToken.None);
        run.Should().Be(new DeliveryRun(1, 0, 1, 0, 0, 1));
        push.Sent.Select(m => m.Target.Endpoint).Should().BeEquivalentTo("https://updates.push.services.mozilla.com/wpush/v2/rina-laptop", "https://fcm.googleapis.com/fcm/send/rina-phone");
        var payload = JsonSerializer.Deserialize<JsonElement>(push.Sent[0].Payload);
        push.Sent[1].Payload.Should().Equal(push.Sent[0].Payload, "every device gets the same message");
        payload.GetProperty("kind").GetString().Should().Be("booking.promoted");
        payload.GetProperty("session").GetProperty("classTypeName").GetString().Should().Be("יוגה");
        payload.GetProperty("inboxItemId").GetGuid().Should().NotBeEmpty();
        push.Sent[0].Urgent.Should().BeTrue("a notice about the member's own booking");
        (await SendAsync(client, HttpMethod.Get, $"{studioPath}/me/push-subscriptions", Customer("rina"))).GetProperty("items").EnumerateArray()
            .Should().ContainSingle().Which.GetProperty("lastSuccessAt").ValueKind.Should().Be(JsonValueKind.String);
        (await db.AsMasterAsync("SELECT count(*) FROM audit.audit_events WHERE action = 'notification.sent'")).Should().Be(1L);

        // 4. The class message meets a busy push service: it is retried in a minute, and the text never travels.
        await SendAsync(client, HttpMethod.Post, $"{sessionPath}/messages", Customer("dana"), new { text = "מביאים מגבת" }, HttpStatusCode.Accepted);
        var busy = new ScriptedPush(PushOutcome.Retry);
        (await new NotificationDeliveryJob(db, noon, _ => Task.FromResult<IPushSender?>(busy)).RunAsync(CancellationToken.None)).Should().Be(new DeliveryRun(1, 0, 0, 1, 0, 0));
        Encoding.UTF8.GetString(busy.Sent.Single().Payload).Should().NotContain("מגבת");
        (await db.AsMasterAsync("SELECT status || ':' || attempts || ':' || (next_attempt_at - updated_at) FROM notifications.deliveries d JOIN notifications.requests r ON r.id = d.request_id WHERE r.kind = 'session.message' AND d.channel = 'push'"))
            .Should().Be("retry_scheduled:1:00:01:00");

        // 5. Rina removes her phone.
        var phoneId = created.GetProperty("id").GetGuid();
        (await RawAsync(client, HttpMethod.Delete, $"{studioPath}/me/push-subscriptions/{phoneId}", Customer("rina"))).StatusCode.Should().Be(HttpStatusCode.NoContent);
        (await RawAsync(client, HttpMethod.Delete, $"{studioPath}/me/push-subscriptions/{phoneId}", Customer("rina"))).StatusCode.Should().Be(HttpStatusCode.NotFound);
    }

    [Fact]
    public async Task Reminders_AreDueOnce_ForActiveMembers_WhoKeepThemOn()
    {
        await using var db = await MigratedDatabase.CreateAsync(postgres);
        using var factory = Factory(db);
        var client = factory.CreateClient();
        var israel = TimeZoneInfo.FindSystemTimeZoneById("Asia/Jerusalem");
        var today = DateOnly.FromDateTime(TimeZoneInfo.ConvertTime(DateTimeOffset.UtcNow, israel).DateTime);
        ReminderJob At(DateOnly date, int hour, int minute = 0) =>
            new(db, new FakeClock(new DateTimeOffset(TimeZoneInfo.ConvertTimeToUtc(date.ToDateTime(new TimeOnly(hour, minute)), israel))));

        await SendAsync(client, HttpMethod.Post, "/api/v1/session", Customer("owner"));
        var studio = await SendAsync(client, HttpMethod.Post, "/api/v1/organizations", Customer("owner"), new { displayName = "סטודיו חוף", slug = "studio-hof" }, HttpStatusCode.Created);
        var studioPath = $"/api/v1/organizations/{studio.GetProperty("id").GetGuid()}";
        var dana = await JoinByInvitationAsync(client, studioPath, "dana", "staff");
        var members = new[] { "noga", "rina", "tal" };
        foreach (var member in members)
        {
            await JoinByInvitationAsync(client, studioPath, member, "client");
        }

        // Rina does not want the evening-before reminder.
        await SendAsync(client, HttpMethod.Put, $"{studioPath}/me/notification-preferences", Customer("rina"), new
        {
            groups = Groups.Select(group => new { group, channels = new { inbox = true, push = true } }),
            reminders = new { classTomorrow = false, classSoon = true, passEnding = true, entriesLow = true },
            quietHours = (object?)null
        }, ifMatch: "0");

        // A class tomorrow at 12:00 and a five-entry card each; all three book.
        var room = await SendAsync(client, HttpMethod.Post, $"{studioPath}/rooms", Customer("owner"), new { name = "חדר", defaultCapacity = 10 }, HttpStatusCode.Created);
        var yoga = await SendAsync(client, HttpMethod.Post, $"{studioPath}/class-types", Customer("owner"), new { name = "יוגה", category = "yoga", color = "sage", defaultMinutes = 60 }, HttpStatusCode.Created);
        var session = await SendAsync(client, HttpMethod.Post, $"{studioPath}/sessions", Customer("owner"), new
        {
            classTypeId = yoga.GetProperty("id").GetGuid(),
            localDate = today.AddDays(1).ToString("yyyy-MM-dd", CultureInfo.InvariantCulture),
            localStart = "12:00",
            instructorMembershipId = dana,
            roomId = room.GetProperty("id").GetGuid(),
            capacity = 10
        }, HttpStatusCode.Created);
        var card = await SendAsync(client, HttpMethod.Post, $"{studioPath}/pass-products", Customer("owner"), new { kind = "punch_card", name = "כרטיסייה", entries = 5, validDays = 60 }, HttpStatusCode.Created);
        var people = new Dictionary<string, Guid>();
        foreach (var member in members)
        {
            people[member] = (await SendAsync(client, HttpMethod.Get, $"{studioPath}/people?query={member}@example.com", Customer("owner"))).GetProperty("items")[0].GetProperty("id").GetGuid();
            await SendAsync(client, HttpMethod.Post, $"{studioPath}/people/{people[member]}/passes", Customer("owner"), new { productId = card.GetProperty("id").GetGuid() }, HttpStatusCode.Created);
            await SendAsync(client, HttpMethod.Post, $"{studioPath}/sessions/{session.GetProperty("id").GetGuid()}/bookings", Customer(member), null, HttpStatusCode.Created);
        }

        // 1. Before the studio's 18:00 nothing is due; after it, the evening-before reminder for Noga and Tal, once.
        (await At(today, 17, 0).RunAsync(CancellationToken.None)).Should().Be(new ReminderRun(0, 0, 0, 0));
        (await At(today, 18, 5).RunAsync(CancellationToken.None)).Should().Be(new ReminderRun(2, 0, 0, 0));
        (await At(today, 19, 0).RunAsync(CancellationToken.None)).Should().Be(new ReminderRun(0, 0, 0, 0), "the dedupe key holds");
        (await db.AsMasterAsync("SELECT count(*) FROM notifications.inbox_items WHERE kind = 'reminder.class_tomorrow' AND person_id = $1", people["rina"])).Should().Be(0L);
        (await db.AsMasterAsync("SELECT count(*) FROM notifications.requests WHERE kind = 'reminder.class_tomorrow' AND data ? 'sessionId' AND data ? 'bookingId'")).Should().Be(2L);

        // 2. Two hours before, everyone booked is told the class is soon. Tal is suspended first and is not.
        await db.AsMasterAsync("UPDATE organizations.memberships m SET status = 'suspended' FROM people.people p WHERE p.organization_id = m.organization_id AND p.membership_id = m.id AND p.id = $1 RETURNING 1", people["tal"]);
        (await At(today.AddDays(1), 9, 0).RunAsync(CancellationToken.None)).Should().Be(new ReminderRun(0, 0, 0, 0), "three hours before is too early");
        (await At(today.AddDays(1), 10, 0).RunAsync(CancellationToken.None)).Should().Be(new ReminderRun(0, 2, 0, 0));
        (await At(today.AddDays(1), 11, 0).RunAsync(CancellationToken.None)).Should().Be(new ReminderRun(0, 0, 0, 0));
        await db.AsMasterAsync("UPDATE organizations.memberships m SET status = 'active' FROM people.people p WHERE p.organization_id = m.organization_id AND p.membership_id = m.id AND p.id = $1 RETURNING 1", people["tal"]);

        // 3. Noga's card is down to one entry: told once, not again at the next tick.
        await db.AsMasterAsync("UPDATE scheduling.passes SET entries_used = entries - 1 WHERE person_id = $1 RETURNING 1", people["noga"]);
        (await At(today.AddDays(1), 13, 0).RunAsync(CancellationToken.None)).Should().Be(new ReminderRun(0, 0, 0, 1));
        (await At(today.AddDays(1), 14, 0).RunAsync(CancellationToken.None)).Should().Be(new ReminderRun(0, 0, 0, 0));

        // 4. A week before the cards end: Noga and Tal are told; Rina already holds a later pass.
        await SendAsync(client, HttpMethod.Post, $"{studioPath}/people/{people["rina"]}/passes", Customer("owner"), new { productId = card.GetProperty("id").GetGuid(), startsOn = today.AddDays(30).ToString("yyyy-MM-dd", CultureInfo.InvariantCulture) }, HttpStatusCode.Created);
        var endsOn = (DateOnly)(await db.AsMasterAsync("SELECT min(ends_on) FROM scheduling.passes WHERE person_id = $1", people["noga"]))!;
        (await At(endsOn.AddDays(-8), 10).RunAsync(CancellationToken.None)).Should().Be(new ReminderRun(0, 0, 0, 0));
        (await At(endsOn.AddDays(-7), 10).RunAsync(CancellationToken.None)).Should().Be(new ReminderRun(0, 0, 2, 0));
        (await At(endsOn.AddDays(-6), 10).RunAsync(CancellationToken.None)).Should().Be(new ReminderRun(0, 0, 0, 0));

        // 5. The studio turns the class-soon reminder off: a new class gets the evening-before one only.
        var settings = await SendAsync(client, HttpMethod.Get, $"{studioPath}/notification-settings", Customer("owner"));
        await SendAsync(client, HttpMethod.Put, $"{studioPath}/notification-settings", Customer("owner"), new
        {
            quietHours = new { startsLocal = "22:00", endsLocal = "08:00" },
            reminders = new
            {
                classTomorrow = new { enabled = true, sendAtLocal = "18:00" },
                classSoon = new { enabled = false, hoursBefore = 2 },
                passEnding = new { enabled = true, daysBefore = 7 },
                entriesLow = new { enabled = true, entriesLeft = 1 }
            }
        }, ifMatch: settings.GetProperty("version").GetString());
        var later = await SendAsync(client, HttpMethod.Post, $"{studioPath}/sessions", Customer("owner"), new
        {
            classTypeId = yoga.GetProperty("id").GetGuid(),
            localDate = today.AddDays(3).ToString("yyyy-MM-dd", CultureInfo.InvariantCulture),
            localStart = "12:00",
            instructorMembershipId = dana,
            roomId = room.GetProperty("id").GetGuid(),
            capacity = 10
        }, HttpStatusCode.Created);
        await SendAsync(client, HttpMethod.Post, $"{studioPath}/sessions/{later.GetProperty("id").GetGuid()}/bookings", Customer("tal"), null, HttpStatusCode.Created);
        (await At(today.AddDays(2), 18).RunAsync(CancellationToken.None)).Should().Be(new ReminderRun(1, 0, 0, 0));
        (await At(today.AddDays(3), 10).RunAsync(CancellationToken.None)).Should().Be(new ReminderRun(0, 0, 0, 0));

        // 6. Reminders go through the router like every other notice (no device here, so push is skipped).
        (await new NotificationDeliveryJob(db, TimeProvider.System).RunAsync(CancellationToken.None)).Routed.Should().Be(8);
        (await db.AsMasterAsync("SELECT count(*) FROM notifications.deliveries d JOIN notifications.requests r ON r.id = d.request_id WHERE r.kind LIKE 'reminder.%' AND d.channel = 'push' AND d.skip_reason = 'no_subscription'")).Should().Be(8L);
    }

    private static readonly string[] Groups = ["bookings", "reminders", "studio"];

    // The browser key and auth secret of RFC 8291 section 5: published test values, no real device. The browser key
    // doubles as a well-formed VAPID public key for the key route.
    private const string BrowserKey = "BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4";
    private const string BrowserAuth = "BTBZMqHH6r4Tts7J_aSIgg";

    private sealed class FakeClock(DateTimeOffset now) : TimeProvider
    {
        public override DateTimeOffset GetUtcNow() => now;
    }

    private async Task ProblemAsync(HttpClient client, HttpMethod method, string path, string subject, object body, string code)
    {
        var response = await RawAsync(client, method, path, Customer(subject), body);
        var text = await response.Content.ReadAsStringAsync();
        response.StatusCode.Should().Be(HttpStatusCode.BadRequest, text);
        JsonSerializer.Deserialize<JsonElement>(text).GetProperty("code").GetString().Should().Be(code);
    }

    private async Task ProblemAsync(HttpClient client, string path, string subject, object body, string code)
    {
        var response = await RawAsync(client, HttpMethod.Put, path, Customer(subject), body);
        var text = await response.Content.ReadAsStringAsync();
        response.StatusCode.Should().Be(HttpStatusCode.BadRequest, text);
        JsonSerializer.Deserialize<JsonElement>(text).GetProperty("code").GetString().Should().Be(code);
    }

    private async Task<Guid> JoinByInvitationAsync(HttpClient client, string studioPath, string subject, string role)
    {
        var invitation = await SendAsync(client, HttpMethod.Post, $"{studioPath}/invitations", Customer("owner"), new { email = $"{subject}@example.com", role }, HttpStatusCode.Created);
        await SendAsync(client, HttpMethod.Post, "/api/v1/session", Customer(subject));
        var membership = await SendAsync(client, HttpMethod.Post, "/api/v1/invitations/accept", Customer(subject), new { token = invitation.GetProperty("link").GetString()!.Split('#')[^1] });
        return membership.GetProperty("membershipId").GetGuid();
    }

    private WebApplicationFactory<Program> Factory(MigratedDatabase db, string? vapidPublicKey = null)
    {
        var key = new RsaSecurityKey(rsa) { KeyId = "test-key" };
        return new WebApplicationFactory<Program>().WithWebHostBuilder(builder =>
        {
            if (vapidPublicKey is not null)
            {
                builder.UseSetting("VAPID_PUBLIC_KEY", vapidPublicKey);
            }

            builder.UseSetting("DATABASE_APP_CONNECTION_STRING", db.ConnectionString(DatabaseRole.Application));
            builder.UseSetting("DATABASE_PLATFORM_CONNECTION_STRING", db.ConnectionString(DatabaseRole.Platform));
            builder.UseSetting("COGNITO_CLIENT_IDS", "customer-client");
            builder.UseSetting("COGNITO_OPERATOR_CLIENT_IDS", "operator-client");
            builder.ConfigureTestServices(services =>
            {
                services.PostConfigure<CognitoOptions>(CognitoAuthentication.CustomerScheme, o => o.Issuer = CustomerIssuer);
                services.PostConfigure<JwtBearerOptions>(CognitoAuthentication.CustomerScheme, o =>
                {
                    o.Authority = null;
                    o.Configuration = new OpenIdConnectConfiguration { Issuer = CustomerIssuer };
                    o.Configuration.SigningKeys.Add(key);
                    o.TokenValidationParameters.ValidIssuer = CustomerIssuer;
                    o.TokenValidationParameters.IssuerSigningKey = key;
                });
                services.AddSingleton<ICognitoUserReader, FakeCognito>();
            });
        });
    }

    /// <summary>A customer access token; <paramref name="freshSignIn"/> sets `auth_time` to now (step-up), otherwise an hour ago.</summary>
    private string Customer(string subject, bool freshSignIn = false)
    {
        var now = DateTime.UtcNow;
        var authTime = new DateTimeOffset(freshSignIn ? now : now.AddHours(-1)).ToUnixTimeSeconds().ToString(CultureInfo.InvariantCulture);
        return new JsonWebTokenHandler().CreateToken(new SecurityTokenDescriptor
        {
            Issuer = CustomerIssuer,
            Subject = new ClaimsIdentity(
            [
                new Claim("sub", subject), new Claim("username", subject), new Claim("token_use", "access"),
                new Claim("client_id", "customer-client"), new Claim("auth_time", authTime)
            ]),
            NotBefore = now.AddMinutes(-1),
            IssuedAt = now.AddMinutes(-1),
            Expires = now.AddMinutes(10),
            SigningCredentials = new SigningCredentials(new RsaSecurityKey(rsa) { KeyId = "test-key" }, SecurityAlgorithms.RsaSha256)
        });
    }

    private static async Task<HttpResponseMessage> RawAsync(HttpClient client, HttpMethod method, string path, string token, object? body = null, string? ifMatch = null)
    {
        using var request = new HttpRequestMessage(method, path);
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);
        if (ifMatch is not null)
        {
            request.Headers.TryAddWithoutValidation("If-Match", $"\"{ifMatch}\"");
        }

        if (body is not null)
        {
            request.Content = JsonContent.Create(body, body.GetType());
        }

        return await client.SendAsync(request);
    }

    private static async Task<JsonElement> SendAsync(HttpClient client, HttpMethod method, string path, string token, object? body = null, HttpStatusCode expected = HttpStatusCode.OK, string? ifMatch = null)
    {
        var response = await RawAsync(client, method, path, token, body, ifMatch);
        var text = await response.Content.ReadAsStringAsync();
        response.StatusCode.Should().Be(expected, $"{method} {path} answered {text}");
        return text.Length == 0 ? default : JsonSerializer.Deserialize<JsonElement>(text);
    }

    /// <summary>Every user's email is their username at example.com, verified.</summary>
    private sealed class FakeCognito : ICognitoUserReader
    {
        public Task<CognitoUser> GetAsync(string issuer, string username, CancellationToken cancellationToken) =>
            Task.FromResult(new CognitoUser($"{username}@example.com", true));
    }
}

/// <summary>Answers every send with one outcome, or Gone for the given push service, and records what was sent.</summary>
internal sealed class ScriptedPush(PushOutcome outcome, string? goneHost = null) : IPushSender
{
    public List<(PushTarget Target, byte[] Payload, bool Urgent)> Sent { get; } = [];

    public Task<(PushOutcome Outcome, int? Status)> SendAsync(PushTarget target, ReadOnlyMemory<byte> payload, bool urgent, CancellationToken cancellationToken)
    {
        Sent.Add((target, payload.ToArray(), urgent));
        var answer = new Uri(target.Endpoint).Host == goneHost ? PushOutcome.Gone : outcome;
        return Task.FromResult<(PushOutcome, int?)>((answer, answer switch { PushOutcome.Retry => 503, PushOutcome.Gone => 410, _ => 201 }));
    }
}
