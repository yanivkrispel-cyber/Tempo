namespace Tempo.Api.Tenancy;

/// <summary>
/// The one permission a tenant route needs (docs/27 section 3.4).
/// <see cref="TenantRouteFilter"/> checks it after loading the caller's
/// permissions: missing, 403 `permission.denied`. A tenant route without it is
/// refused too (default deny), and an architecture test fails the build first.
/// Resource rules (self, rank) stay in the application services.
/// </summary>
[AttributeUsage(AttributeTargets.Method | AttributeTargets.Class)]
public sealed class RequirePermissionAttribute(string permission) : Attribute
{
    public string Permission { get; } = permission;
}

public static class RequirePermissionExtensions
{
    public static TBuilder RequirePermission<TBuilder>(this TBuilder builder, string permission)
        where TBuilder : IEndpointConventionBuilder =>
        builder.WithMetadata(new RequirePermissionAttribute(permission));
}
