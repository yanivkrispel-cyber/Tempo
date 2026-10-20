namespace Tempo.Api.Middleware;

/// <summary>
/// Every answer that doesn't set its own `Cache-Control` gets `private, no-store` (K5, board #404): most answers
/// carry a person's data, and the token travels in `X-Tempo-Authorization`, which a shared cache doesn't treat like
/// `Authorization`. The public routes set `public` caching themselves.
/// </summary>
public sealed class NoStoreByDefaultMiddleware(RequestDelegate next)
{
    public Task InvokeAsync(HttpContext context)
    {
        context.Response.OnStarting(() =>
        {
            if (!context.Response.Headers.ContainsKey("Cache-Control"))
            {
                context.Response.Headers.CacheControl = "private, no-store";
            }

            return Task.CompletedTask;
        });
        return next(context);
    }
}
