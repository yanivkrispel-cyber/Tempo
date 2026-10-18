using System.Collections.Concurrent;
using Amazon.S3;
using Amazon.S3.Model;
using Tempo.Platform.BuildingBlocks.Errors;

namespace Tempo.Platform.Modules.Media;

/// <summary>
/// Where the bytes of pictures live (docs/33 section 6, D17): the environment's private S3 bucket. Uploads go
/// straight from the app to a presigned POST under `incoming/`, whose signed policy caps the size (#345); the API
/// reads them back, re-encodes them and writes the result under `media/`. Reads are presigned GETs. Nothing in the
/// bucket is public.
/// </summary>
public interface IMediaStore
{
    /// <summary>False when no bucket is configured (local runs): the upload routes answer 503 media.unavailable.</summary>
    bool Available { get; }

    /// <summary>Deprecated: the old upload, which cannot cap the size. Removed once the apps POST (#345, H-1b).</summary>
    Uri PresignPut(string key, string contentType, TimeSpan lifetime);

    /// <summary>A browser form upload to <paramref name="key"/>: S3 refuses another key, another content type, an empty file or one over <paramref name="maxBytes"/>.</summary>
    PresignedForm PresignPost(string key, string contentType, long maxBytes, TimeSpan lifetime);

    Uri PresignGet(string key, TimeSpan lifetime);

    /// <summary>The object's bytes, or null when it is missing or larger than <paramref name="maxBytes"/>.</summary>
    Task<byte[]?> ReadAsync(string key, int maxBytes, CancellationToken cancellationToken);

    Task WriteAsync(string key, byte[] bytes, string contentType, CancellationToken cancellationToken);

    Task DeleteAsync(IReadOnlyList<string> keys, CancellationToken cancellationToken);
}

/// <summary>A presigned POST: send every field as is, then the file last as `file`, as `multipart/form-data` to <see cref="Url"/>.</summary>
public sealed record PresignedForm(Uri Url, IReadOnlyDictionary<string, string> Fields);

/// <summary>The object keys of one picture, from its id alone, so a URL never needs a database read (ids are UUIDv7 and every URL is presigned).</summary>
public static class MediaKeys
{
    public static string Incoming(Guid mediaId) => $"incoming/{mediaId:D}";

    public static string Large(Guid mediaId) => $"media/{mediaId:D}/large.webp";

    public static string Small(Guid mediaId) => $"media/{mediaId:D}/small.webp";

    /// <summary>How long a picture URL in a response works; the apps cache the image as long.</summary>
    public static readonly TimeSpan UrlLifetime = TimeSpan.FromHours(6);
}

public sealed class S3MediaStore(IAmazonS3 s3, string bucket) : IMediaStore
{
    public bool Available => true;

    public Uri PresignPut(string key, string contentType, TimeSpan lifetime) =>
        new(s3.GetPreSignedURL(new GetPreSignedUrlRequest
        {
            BucketName = bucket,
            Key = key,
            Verb = HttpVerb.PUT,
            ContentType = contentType,
            Expires = DateTime.UtcNow.Add(lifetime)
        }));

    public PresignedForm PresignPost(string key, string contentType, long maxBytes, TimeSpan lifetime)
    {
        var form = s3.CreatePresignedPost(new CreatePresignedPostRequest
        {
            BucketName = bucket,
            Key = key,
            Expires = DateTime.UtcNow.Add(lifetime),
            Fields = new Dictionary<string, string> { ["Content-Type"] = contentType },
            Conditions =
            [
                S3PostCondition.ContentLengthRange(1, maxBytes),
                S3PostCondition.ExactMatch("Content-Type", contentType)
            ]
        });
        return new PresignedForm(new Uri(form.Url), new Dictionary<string, string>(form.Fields));
    }

    public Uri PresignGet(string key, TimeSpan lifetime) =>
        new(s3.GetPreSignedURL(new GetPreSignedUrlRequest
        {
            BucketName = bucket,
            Key = key,
            Verb = HttpVerb.GET,
            Expires = DateTime.UtcNow.Add(lifetime)
        }));

    public async Task<byte[]?> ReadAsync(string key, int maxBytes, CancellationToken cancellationToken)
    {
        try
        {
            using var response = await s3.GetObjectAsync(bucket, key, cancellationToken);
            if (response.ContentLength > maxBytes)
            {
                return null;
            }

            using var buffer = new MemoryStream((int)response.ContentLength);
            await response.ResponseStream.CopyToAsync(buffer, cancellationToken);
            return buffer.ToArray();
        }
        catch (AmazonS3Exception e) when (e.StatusCode == System.Net.HttpStatusCode.NotFound)
        {
            return null;
        }
    }

    public async Task WriteAsync(string key, byte[] bytes, string contentType, CancellationToken cancellationToken)
    {
        using var body = new MemoryStream(bytes);
        await s3.PutObjectAsync(new PutObjectRequest
        {
            BucketName = bucket,
            Key = key,
            InputStream = body,
            ContentType = contentType,
            Headers = { CacheControl = "private, max-age=21600" }
        }, cancellationToken);
    }

    public async Task DeleteAsync(IReadOnlyList<string> keys, CancellationToken cancellationToken)
    {
        if (keys.Count == 0)
        {
            return;
        }

        await s3.DeleteObjectsAsync(new DeleteObjectsRequest
        {
            BucketName = bucket,
            Objects = [.. keys.Select(k => new KeyVersion { Key = k })]
        }, cancellationToken);
    }
}

/// <summary>No bucket configured: pictures can't be uploaded and none are linked.</summary>
public sealed class UnavailableMediaStore : IMediaStore
{
    public bool Available => false;

    public Uri PresignPut(string key, string contentType, TimeSpan lifetime) => throw Unavailable();

    public PresignedForm PresignPost(string key, string contentType, long maxBytes, TimeSpan lifetime) => throw Unavailable();

    public Uri PresignGet(string key, TimeSpan lifetime) => throw Unavailable();

    public Task<byte[]?> ReadAsync(string key, int maxBytes, CancellationToken cancellationToken) => throw Unavailable();

    public Task WriteAsync(string key, byte[] bytes, string contentType, CancellationToken cancellationToken) => throw Unavailable();

    public Task DeleteAsync(IReadOnlyList<string> keys, CancellationToken cancellationToken) => Task.CompletedTask;

    internal static DomainRuleViolationException Unavailable() =>
        new(ViolationKind.ServiceUnavailable, "media.unavailable", "Pictures are not available here.");
}

/// <summary>An in-memory store for tests and local runs; presigned URLs point at a fake host.</summary>
public sealed class InMemoryMediaStore : IMediaStore
{
    private readonly ConcurrentDictionary<string, byte[]> objects = new();

    public bool Available => true;

    public IReadOnlyCollection<string> Keys => [.. objects.Keys];

    public Uri PresignPut(string key, string contentType, TimeSpan lifetime) => new($"https://media.test/{key}?put");

    public PresignedForm PresignPost(string key, string contentType, long maxBytes, TimeSpan lifetime) =>
        new(new Uri($"https://media.test/{key}?post"), new Dictionary<string, string> { ["key"] = key, ["Content-Type"] = contentType });

    public Uri PresignGet(string key, TimeSpan lifetime) => new($"https://media.test/{key}");

    /// <summary>What the app's PUT to the presigned URL does.</summary>
    public void Upload(string key, byte[] bytes) => objects[key] = bytes;

    public Task<byte[]?> ReadAsync(string key, int maxBytes, CancellationToken cancellationToken) =>
        Task.FromResult(objects.TryGetValue(key, out var bytes) && bytes.Length <= maxBytes ? bytes : null);

    public Task WriteAsync(string key, byte[] bytes, string contentType, CancellationToken cancellationToken)
    {
        objects[key] = bytes;
        return Task.CompletedTask;
    }

    public Task DeleteAsync(IReadOnlyList<string> keys, CancellationToken cancellationToken)
    {
        foreach (var key in keys)
        {
            objects.TryRemove(key, out _);
        }

        return Task.CompletedTask;
    }
}
