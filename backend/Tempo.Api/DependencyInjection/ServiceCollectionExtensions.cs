using Tempo.Api.ErrorHandling;

namespace Tempo.Api.DependencyInjection;

public static class ServiceCollectionExtensions
{
    public static IServiceCollection AddTempoApi(this IServiceCollection services)
    {
        services.AddExceptionHandler<GlobalExceptionHandler>();
        services.AddProblemDetails();
        services.AddOpenApi();

        return services;
    }
}
