import { describe, expect, it } from "vitest";
import developmentConfig from "../../config/development";
import { pagesHeadersFile } from "../../lib/web/pages-headers";

const apiUrl = "https://2a5q3fao7a.execute-api.eu-central-1.amazonaws.com/";

describe("Cloudflare Pages headers (ADR-0027)", () => {
  const file = pagesHeadersFile(developmentConfig, apiUrl);

  it("applies to every path", () => {
    expect(file.split("\n")[0]).toBe("/*");
  });

  it("lets the apps call the cross-origin API, Cognito and the picture bucket, and nothing else", () => {
    const csp = file.split("\n").find((line) => line.includes("Content-Security-Policy"));
    expect(csp).toContain(
      "connect-src 'self' https://2a5q3fao7a.execute-api.eu-central-1.amazonaws.com " +
        "https://tempo-dev-687239340846.auth.eu-central-1.amazoncognito.com https://cognito-idp.eu-central-1.amazonaws.com " +
        "https://tempo-dev-media-687239340846.s3.eu-central-1.amazonaws.com;"
    );
    expect(csp).toContain("script-src 'self'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).not.toContain("unsafe-eval");
  });

  it("shows pictures from the bucket's presigned URLs (docs/33 section 6; board #347: avatars were blocked)", () => {
    const csp = file.split("\n").find((line) => line.includes("Content-Security-Policy"));
    expect(csp).toContain(
      "img-src 'self' data: blob: https://tempo-dev-media-687239340846.s3.eu-central-1.amazonaws.com " +
        "https://2a5q3fao7a.execute-api.eu-central-1.amazonaws.com;"
    );
  });

  it("lets a studio's path load its manifest and icons from the API (docs/35 W-6, WL4)", () => {
    const csp = file.split("\n").find((line) => line.includes("Content-Security-Policy"));
    expect(csp).toContain("manifest-src 'self' https://2a5q3fao7a.execute-api.eu-central-1.amazonaws.com;");
  });

  it("carries the headers of CloudFront's managed SecurityHeadersPolicy", () => {
    expect(file).toContain("Strict-Transport-Security: max-age=31536000");
    expect(file).toContain("X-Content-Type-Options: nosniff");
    expect(file).toContain("X-Frame-Options: SAMEORIGIN");
    expect(file).toContain("Referrer-Policy: strict-origin-when-cross-origin");
  });

  it("lets browsers keep the hashed build files for a year, and only those", () => {
    const lines = file.split("\n");
    const assets = lines.indexOf("/assets/*");
    expect(assets).toBeGreaterThan(0);
    expect(lines[assets + 1]).toBe("  Cache-Control: public, max-age=31536000, immutable");
    expect(lines.filter((line) => line.includes("Cache-Control"))).toHaveLength(1);
  });

  it("refuses an API that is not https", () => {
    expect(() => pagesHeadersFile(developmentConfig, "http://localhost:5000")).toThrow(/must be https/);
  });
});
