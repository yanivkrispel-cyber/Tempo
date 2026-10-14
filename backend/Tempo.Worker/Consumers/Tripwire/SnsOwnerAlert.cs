using Amazon.SimpleNotificationService;
using Amazon.SimpleNotificationService.Model;
using Tempo.Platform.Modules.PlatformAdmin;

namespace Tempo.Worker.Consumers.Tripwire;

/// <summary>Publishes to the environment's existing alarm topic (`tempo-{env}-alarms`), which emails the owner.</summary>
public sealed class SnsOwnerAlert(string topicArn) : IOwnerAlert, IDisposable
{
    private readonly AmazonSimpleNotificationServiceClient client = new();

    public Task SendAsync(string subject, string message, CancellationToken cancellationToken) =>
        client.PublishAsync(new PublishRequest { TopicArn = topicArn, Subject = subject, Message = message }, cancellationToken);

    public void Dispose() => client.Dispose();
}
