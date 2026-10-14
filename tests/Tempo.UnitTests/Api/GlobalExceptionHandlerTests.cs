using FluentAssertions;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.Logging.Abstractions;
using Tempo.Api.ErrorHandling;
using Xunit;

namespace Tempo.UnitTests.Api;

public sealed class GlobalExceptionHandlerTests
{
    [Fact]
    public async Task TryHandleAsync_ReturnsProblemDetails_WithoutExposingExceptionDetails()
    {
        var handler = new GlobalExceptionHandler(NullLogger<GlobalExceptionHandler>.Instance);
        var context = new DefaultHttpContext { Response = { Body = new MemoryStream() } };
        const string secretMessage = "connection failed: password=SuperSecret123";

        var handled = await handler.TryHandleAsync(context, new InvalidOperationException(secretMessage), CancellationToken.None);

        handled.Should().BeTrue();
        context.Response.StatusCode.Should().Be(StatusCodes.Status500InternalServerError);

        context.Response.Body.Seek(0, SeekOrigin.Begin);
        var body = await new StreamReader(context.Response.Body).ReadToEndAsync();

        body.Should().NotContain(secretMessage);
        body.Should().NotContain("StackTrace");
        body.Should().NotContain("at Tempo.");
        body.Should().Contain("correlationId");
    }
}
