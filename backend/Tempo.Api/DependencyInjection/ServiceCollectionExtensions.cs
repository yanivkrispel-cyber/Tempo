using Tempo.Api.Endpoints;
using Tempo.Api.ErrorHandling;
using Tempo.Api.Identity;
using Tempo.Api.Tenancy;
using Tempo.Platform.BuildingBlocks.Persistence;
using Tempo.Platform.BuildingBlocks.Tenancy;
using Tempo.Platform.Modules.Audit;
using Tempo.Platform.Modules.Identity.Application;
using Tempo.Platform.Modules.Identity.Infrastructure;
using Tempo.Platform.Modules.Organizations.Application;
using Tempo.Platform.Modules.People.Application;
using Tempo.Platform.Modules.Organizations.Infrastructure;
using Tempo.Platform.Modules.PlatformAdmin;

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

        services.AddSingleton<IDataSourceProvider>(sp =>
        {
            var configuration = sp.GetRequiredService<IConfiguration>();
            return new ConfiguredDataSourceProvider(key => configuration[key]);
        });
        services.AddSingleton<IAccountDirectory, AccountDirectory>();
        services.AddSingleton<IMembershipDirectory, MembershipDirectory>();
        services.AddSingleton<ICognitoUserReader, CognitoUserReader>();
        services.AddSingleton<IAccountService, AccountService>();
        services.AddSingleton<IAccountProfiles, AccountProfiles>();
        services.AddSingleton<IOrganizationService, OrganizationService>();
        services.AddSingleton<IMemberService, MemberService>();
        services.AddSingleton<IOwnershipService, OwnershipService>();
        services.AddSingleton<IPeopleService, PeopleService>();
        services.AddSingleton<IConsentService, ConsentService>();
        services.AddSingleton<IPersonLifecycleService, PersonLifecycleService>();
        services.AddSingleton<IAttemptLimiter, AttemptLimiter>();
        services.AddSingleton<IInvitationService, InvitationService>();
        services.AddSingleton<IJoinLinkService, JoinLinkService>();
        services.AddSingleton<AppLinks>();
        services.AddSingleton<PlatformService>();
        services.AddSingleton<IPlatformService>(sp => sp.GetRequiredService<PlatformService>());
        services.AddSingleton<IOperatorDirectory>(sp => sp.GetRequiredService<PlatformService>());
        services.AddSingleton<IAuditService, AuditService>();
        services.AddScoped<OperatorRouteFilter>();
        services.AddSingleton(TimeProvider.System);
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
