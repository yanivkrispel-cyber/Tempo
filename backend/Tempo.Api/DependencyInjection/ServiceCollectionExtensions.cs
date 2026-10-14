using Tempo.Api.ErrorHandling;
using Tempo.Api.Identity;
using Tempo.Api.Persistence;
using Tempo.Api.Tenancy;
using Tempo.Platform.BuildingBlocks.Persistence;
using Tempo.Platform.BuildingBlocks.Tenancy;
using Tempo.Platform.Modules.Identity.Application;
using Tempo.Platform.Modules.Identity.Infrastructure;
using Tempo.Platform.Modules.Organizations.Application;
using Tempo.Platform.Modules.Organizations.Infrastructure;

namespace Tempo.Api.DependencyInjection;

public static class ServiceCollectionExtensions
{
    public static IServiceCollection AddTempoApi(this IServiceCollection services)
    {
        // Order matters: the first handler that returns true answers.
        services.AddExceptionHandler<DomainRuleViolationHandler>();
        services.AddExceptionHandler<GlobalExceptionHandler>();
        services.AddProblemDetails();
        services.AddOpenApi();

        services.AddSingleton<IDataSourceProvider, ConfiguredDataSourceProvider>();
        services.AddSingleton<IAccountDirectory, AccountDirectory>();
        services.AddSingleton<IMembershipDirectory, MembershipDirectory>();
        services.AddSingleton<ICognitoUserReader, CognitoUserReader>();
        services.AddSingleton<IAccountService, AccountService>();
        services.AddSingleton<IAccountProfiles, AccountProfiles>();
        services.AddSingleton<IOrganizationService, OrganizationService>();
        services.AddSingleton<IMemberService, MemberService>();
        services.AddScoped<TenantRouteFilter>();

        return services;
    }

    /// <summary>Maps every <see cref="IEndpointModule"/> registered in DI.</summary>
    public static IEndpointRouteBuilder MapEndpointModules(this IEndpointRouteBuilder endpoints)
    {
        foreach (var module in endpoints.ServiceProvider.GetServices<IEndpointModule>())
        {
            module.Map(endpoints);
        }

        return endpoints;
    }
}
