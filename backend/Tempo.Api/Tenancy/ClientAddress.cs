using System.Net;

namespace Tempo.Api.Tenancy;

/// <summary>
/// The address a per-address limit counts (board #404 S-A, #419 review). On the HTTP API it is API Gateway's source
/// IP; a caller's headers count for nothing there. On the edge's Function URL, which takes only requests CloudFront
/// signed with its origin access control (api-stack.ts), the Lambda sees an edge address, so the viewer's address is
/// the one CloudFront puts in `CloudFront-Viewer-Address` (`ip:port`); without it there is no address to count.
/// </summary>
public static class ClientAddress
{
    public const string ViewerHeader = "CloudFront-Viewer-Address";

    public static string? Of(HttpContext context)
    {
        if (!context.Request.Host.Host.Contains(".lambda-url.", StringComparison.OrdinalIgnoreCase))
        {
            return context.Connection.RemoteIpAddress?.ToString();
        }

        var viewer = context.Request.Headers[ViewerHeader].ToString();
        var colon = viewer.LastIndexOf(':');
        return colon > 0 && IPAddress.TryParse(viewer[..colon], out var address) ? address.ToString() : null;
    }
}
