# Runbook: replaying messages from the dead-letter queue

Written on 2026-11-07 (board #627, for #543). Not rehearsed yet: dev's DLQ held no message that day, so the first
real use also serves as the test. Add what it showed here.

## What is there

| | |
|---|---|
| Work queue | `tempo-<env>-work`, SQS Standard, 14 days retention, at-least-once delivery (ADR-0008) |
| Dead-letter queue | `tempo-<env>-work-dlq`, 14 days retention |
| Consumer | Lambda `worker-outbox`, batch of 10, reports failures per message |
| Moved to the DLQ after | 5 failed receives (`maxReceiveCount`, `infrastructure/lib/constructs/secure-queue.ts`) |
| Alarms | `<queue>-dlq-messages` (any message), `<queue>-oldest-message-age`; only where `observability.alarmsEnabled` is on |

A message with no handler for its `MessageType` attribute throws in `SqsMessageDispatcher`, so it reaches the DLQ too.

**14 days is the limit.** A message left in the DLQ longer is gone. Look at the alarm the same day.

## Is it safe to send again?

Every kind of message on the queue can run twice, so a replay does no harm on its own. Most of them carry no work:
the job reads the database when it runs, so an old message does today's work, not the work of the day it failed.

| `MessageType` | Sent by | Run again | Why |
|---|---|---|---|
| `scheduling.daily` | EventBridge Scheduler | Safe | `SchedulingDailyJob`: "safe to run twice" |
| `retention.daily` | EventBridge Scheduler | Safe | `RetentionJob`: deletes what is past keeping, by date |
| `notifications.reminders_hourly` | EventBridge Scheduler | Safe | `ReminderJob`: the dedupe key stops a second reminder |
| `notifications.deliver` | The API | Safe | `NotificationDeliveryJob`: one line per request and channel |
| `tripwire.check` | EventBridge Scheduler | Safe | Only counts studios; may send the owner alert again |
| `smoke-test` | The deploy's smoke test | Pointless | It proved a deploy that is over |
| `outbox.publish` | Reserved for the outbox | Safe | `OutboxMessageHandler` only logs |

Add a row here with every new message type. A new type that is not safe to repeat changes this runbook.

## The procedure

Dev is shown; for production use `prod` and the production profile. `<profile>` is your SSO profile, region
`eu-central-1`. These commands change only the queues. On production, moving messages is announced first.

**1. Count them.**

```bash
DLQ_URL=$(aws sqs get-queue-url --queue-name tempo-dev-work-dlq --profile <profile> --query QueueUrl --output text)
aws sqs get-queue-attributes --queue-url "$DLQ_URL" --attribute-names ApproximateNumberOfMessages --profile <profile>
```

**2. Find out why before moving anything.** Search the worker's logs for the time of the alarm (`CorrelationId` ties a
message to its lines). Then look at a few messages without removing them:

```bash
aws sqs receive-message --queue-url "$DLQ_URL" --max-number-of-messages 10 --visibility-timeout 30 \
  --attribute-names All --message-attribute-names All --profile <profile>
```

They come back to the queue after 30 seconds. A body can hold ids, so don't paste it into an issue or a board.

**3. Fix the cause first.** Replaying before the fix is deployed sends the messages through five more failures and back
to the DLQ. A database or provider that was down and is back needs no fix.

**4. Move them back.** SQS treats them as new messages, with a new id and a new retention period. Keep the rate low:
each message wakes the worker, and the worker wakes Neon.

```bash
DLQ_ARN=$(aws sqs get-queue-attributes --queue-url "$DLQ_URL" --attribute-names QueueArn \
  --profile <profile> --query Attributes.QueueArn --output text)
WORK_ARN=${DLQ_ARN%-dlq}
aws sqs start-message-move-task --source-arn "$DLQ_ARN" --destination-arn "$WORK_ARN" \
  --max-number-of-messages-per-second 5 --profile <profile>
```

**5. Watch it.** `aws sqs list-message-move-tasks --source-arn "$DLQ_ARN" --profile <profile>` shows the status and the
count moved. `aws sqs cancel-message-move-task --task-handle <handle> --profile <profile>` stops it. Then check that
the DLQ count stays at 0 and the worker's logs show the handler's line, not the exception.

**6. Write it down.** For an incident, what failed, how many messages and what was replayed go into the incident's
notes (`docs/runbooks/production-readiness.md` section 8).

## When not to replay

- The messages fail because of the message itself: they will return. Keep them until the code handles them or the
  owner agrees to drop them. Purging is deleting, so on production it needs the owner's approval.
- Only `smoke-test` messages are there: they age out on their own, and nothing needs them.

## Related

- ADR-0008, `docs/17_Background_Jobs.md`, `docs/19_DevOps.md` section 9
- `docs/runbooks/production-readiness.md` section 3c, `docs/runbooks/environment-inventory.md`
