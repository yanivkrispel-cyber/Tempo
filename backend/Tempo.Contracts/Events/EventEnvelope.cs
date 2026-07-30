namespace Tempo.Contracts.Events;

/// <summary>
/// The Tempo integration-event envelope (docs/01_AWS_Infrastructure_LLD.md
/// section 16.3). Every event published to EventBridge is wrapped in this
/// shape, whatever <typeparamref name="TData"/> the event carries.
/// </summary>
public sealed record EventEnvelope<TData>(
    Guid EventId,
    string EventType,
    int SchemaVersion,
    DateTimeOffset OccurredAt,
    Guid? OrganizationId,
    string CorrelationId,
    Guid? CausationId,
    EventActor Actor,
    TData Data);

public sealed record EventActor(string Type, Guid Id);
