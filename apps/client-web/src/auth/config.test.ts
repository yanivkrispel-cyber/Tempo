import { describe, expect, it } from "vitest";
import { brandedLoginEnabled, readAppConfig } from "./config";

describe("readAppConfig", () => {
  it("builds the callback and logout URLs from the app origin", () => {
    const env = {
      VITE_API_URL: "https://api.example/",
      VITE_COGNITO_DOMAIN: "https://auth.example/",
      VITE_COGNITO_CLIENT_ID: "abc",
    } as ImportMetaEnv;
    expect(readAppConfig(env, "http://localhost:5174")).toEqual({
      apiUrl: "https://api.example",
      auth: {
        cognitoDomain: "https://auth.example",
        clientId: "abc",
        redirectUri: "http://localhost:5174/auth/callback",
        logoutUri: "http://localhost:5174/",
      },
    });
  });

  it("has no auth when the Cognito variables are missing", () => {
    expect(readAppConfig({} as ImportMetaEnv, "http://localhost:5174").auth).toBeNull();
  });
});

describe("brandedLoginEnabled", () => {
  it("is on only for the exact value true", () => {
    expect(brandedLoginEnabled({ VITE_BRANDED_LOGIN: "true" } as ImportMetaEnv)).toBe(true);
    expect(brandedLoginEnabled({ VITE_BRANDED_LOGIN: "1" } as ImportMetaEnv)).toBe(false);
    expect(brandedLoginEnabled({} as ImportMetaEnv)).toBe(false);
  });
});
