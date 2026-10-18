using Tempo.Api.Endpoints;
using Tempo.Api.ErrorHandling;
using Tempo.Api.Identity;
using Tempo.Api.Tenancy;
using Tempo.Platform.BuildingBlocks.Persistence;
using Tempo.Platform.BuildingBlocks.Tenancy;
using Tempo.Platform.Modules.Audit;
using Tempo.Platform.Modules.Identity.Application;
using Tempo.Platform.Modules.Identity.Infrastructure;
using Tempo.Platform.Modules.Notifications.Application;
using Tempo.Platform.Modules.Notifications.Infrastructure;
using Tempo.Platform.Modules.Organizations.Application;
using Tempo.Platform.Modules.Billing;
using Tempo.Platform.Modules.Media;
using Tempo.Platform.Modules.People.Application;
using Tempo.Platform.Modules.People.Infrastructure;
using Tempo.Platform.Modules.Scheduling.Application;
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
        services.AddSingleton<ICognitoUserDeleter, CognitoUserDeleter>();
        services.AddSingleton<IAccountDeletionService, AccountDeletionService>();
        services.AddSingleton<IAccountProfiles, AccountProfiles>();
        services.AddSingleton<IOrganizationService, OrganizationService>();
        services.AddSingleton<IMemberService, MemberService>();
        services.AddSingleton<IOwnershipService, OwnershipService>();
        services.AddSingleton<IPeopleService, PeopleService>();
        services.AddSingleton<IPeopleImportService, PeopleImportService>();
        services.AddSingleton<IPeopleTagsAndNotesService, PeopleTagsAndNotesService>();
        services.AddSingleton<ITimetableService, TimetableService>();
        services.AddSingleton<IPassService, PassService>();
        services.AddSingleton<IBillingService, BillingService>();
        services.AddSingleton<BookingService>();
        services.AddSingleton<IBookingService>(provider => provider.GetRequiredService<BookingService>());
        services.AddSingleton<IClassService>(provider => provider.GetRequiredService<BookingService>());
        services.AddSingleton<ISpotService>(provider => provider.GetRequiredService<BookingService>());
        services.AddSingleton<ICheckinService>(provider => provider.GetRequiredService<BookingService>());
        services.AddSingleton<IBuddyService, BuddyService>();
        services.AddSingleton<IMediaService, MediaService>();
        services.AddSingleton<IInstructorService, InstructorService>();
        services.AddSingleton<ISessionMessageService>(provider => provider.GetRequiredService<BookingService>());
        services.AddSingleton<IBookingCalendarService>(provider => provider.GetRequiredService<BookingService>());
        services.AddSingleton<IStudioSettingsService, StudioSettingsService>();
        services.AddSingleton<IProgressService, ProgressService>();
        services.AddSingleton<IReportService, ReportService>();
        services.AddSingleton<INotificationPreferencesService, NotificationPreferencesService>();
        services.AddSingleton<INotificationTemplateService, NotificationTemplateService>();
        services.AddSingleton<IAnnouncementService, AnnouncementService>();
        services.AddSingleton<IDeliveryLogService, DeliveryLogService>();
        services.AddSingleton<IPushSubscriptionService, PushSubscriptionService>();
        services.AddSingleton(sp => new VapidKeySource(key => sp.GetRequiredService<IConfiguration>()[key], needsPrivateKey: false));
        services.AddSingleton<IConsentService, ConsentService>();
        services.AddSingleton<IHealthDataKeys>(sp => new HealthDataKeys(key => sp.GetRequiredService<IConfiguration>()[key]));
        services.AddSingleton<IHealthDeclarationService, HealthDeclarationService>();
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
        services.AddSingleton(sp => OwnerMfaPolicy.From(sp.GetRequiredService<IConfiguration>()));

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
