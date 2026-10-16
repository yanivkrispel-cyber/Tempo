import { CfnOutput, Duration, RemovalPolicy, Stack, StackProps } from "aws-cdk-lib";
import { AccountRecovery, ClientAttributes, Mfa, OAuthScope, UserPool, UserPoolClient } from "aws-cdk-lib/aws-cognito";
import { Construct } from "constructs";
import { TempoEnvironmentConfig, resourceName } from "../../config/environment-config";
import { applyStandardTags } from "../constructs/tagging";

/** SSM path of the smoke-test user's `email` (String) and `password` (SecureString), created by hand. */
export function smokeTestParameterPath(config: TempoEnvironmentConfig): string {
  return `/tempo/${config.environmentName}/smoke-test`;
}

export interface IdentityStackProps extends StackProps {
  readonly config: TempoEnvironmentConfig;
}

/**
 * Amazon Cognito User Pool for authentication only (ADR-0007). Cognito owns
 * credentials, challenges and token issuance; Tempo owns internal user
 * identity, organization membership and business authorization - Cognito
 * groups are intentionally never used here as an authorization model.
 *
 * A Hosted UI domain is created because every app client uses the OAuth
 * Authorization Code + PKCE flow against Cognito's `/oauth2/authorize` and
 * `/oauth2/token` endpoints (exact callback/logout URLs only, no wildcards);
 * that flow requires a domain regardless of whether the login page itself
 * uses AWS's default styling or a branded page hosted by each app.
 *
 * Two pools (ADR-0023). `users` holds studio owners, admins, staff and
 * clients: self sign-up is on because studio owners onboard themselves, and
 * a new account gets no tenant access until Tempo grants it. `operators`
 * holds the Tempo team: no self sign-up, MFA required (TOTP only) and short
 * sessions. The API accepts each pool's tokens only on its own routes.
 */
export class IdentityStack extends Stack {
  public readonly userPool: UserPool;
  public readonly adminWebClient: UserPoolClient;
  public readonly clientWebClient: UserPoolClient;
  public readonly operatorPool: UserPool;
  public readonly platformAdminWebClient: UserPoolClient;

  constructor(scope: Construct, id: string, props: IdentityStackProps) {
    super(scope, id, props);
    const { config } = props;

    this.userPool = new UserPool(this, "UserPool", {
      userPoolName: resourceName(config, "users"),
      selfSignUpEnabled: true,
      signInAliases: { email: true, username: false },
      autoVerify: { email: true },
      // A changed email takes effect only after the user verifies it (#124); until then they sign in with the old one.
      keepOriginal: { email: true },
      standardAttributes: {
        email: { required: true, mutable: true }
      },
      passwordPolicy: {
        minLength: 12,
        requireLowercase: true,
        requireUppercase: true,
        requireDigits: true,
        requireSymbols: true
      },
      mfa: Mfa.OPTIONAL,
      mfaSecondFactor: { otp: true, sms: false },
      accountRecovery: AccountRecovery.EMAIL_ONLY,
      deletionProtection: config.enableDeletionProtection,
      removalPolicy: config.environmentName === "prod" ? RemovalPolicy.RETAIN : RemovalPolicy.DESTROY
    });

    // Domain prefix is globally unique across all AWS accounts; the account
    // id suffix avoids collisions with any other Cognito user in the world.
    this.userPool.addDomain("Domain", {
      cognitoDomain: { domainPrefix: `tempo-${config.environmentName}-${config.accountId}` }
    });

    this.adminWebClient = this.addBrowserClient(this.userPool, "AdminWebClient", {
      clientName: resourceName(config, "admin-web"),
      callbackUrls: config.cognitoCallbackUrls.adminWeb,
      logoutUrls: config.cognitoLogoutUrls.adminWeb,
      // Two-step sign-in enrollment (O8) calls AssociateSoftwareToken, VerifySoftwareToken and
      // SetUserMFAPreference with the user's access token, which needs this scope. The same token could also
      // change the user's attributes, so this client may write only email (required by Hosted UI sign-up, and a
      // change needs re-verification) and read only email and its verification.
      extraScopes: [OAuthScope.COGNITO_ADMIN],
      readAttributes: new ClientAttributes().withStandardAttributes({ email: true, emailVerified: true }),
      writeAttributes: new ClientAttributes().withStandardAttributes({ email: true })
    });

    this.clientWebClient = this.addBrowserClient(this.userPool, "ClientWebClient", {
      clientName: resourceName(config, "client-web"),
      callbackUrls: config.cognitoCallbackUrls.clientWeb,
      logoutUrls: config.cognitoLogoutUrls.clientWeb,
      // AdminInitiateAuth needs IAM credentials, so browsers cannot use this flow; the smoke test can.
      adminUserPassword: config.featureFlags.enableSmokeTestSignIn === true
    });

    // Read by tools/scripts/smoke-test.mjs from cdk-outputs.json. Ids, not secrets.
    new CfnOutput(this, "UserPoolId", { value: this.userPool.userPoolId });
    new CfnOutput(this, "ClientWebClientId", { value: this.clientWebClient.userPoolClientId });
    if (config.featureFlags.enableSmokeTestSignIn) {
      new CfnOutput(this, "SmokeTestParameterPath", { value: smokeTestParameterPath(config) });
    }

    this.operatorPool = new UserPool(this, "OperatorPool", {
      userPoolName: resourceName(config, "operators"),
      selfSignUpEnabled: false,
      signInAliases: { email: true, username: false },
      autoVerify: { email: true },
      // A changed email takes effect only after the user verifies it (#124); until then they sign in with the old one.
      keepOriginal: { email: true },
      standardAttributes: {
        email: { required: true, mutable: true }
      },
      passwordPolicy: {
        minLength: 14,
        requireLowercase: true,
        requireUppercase: true,
        requireDigits: true,
        requireSymbols: true,
        tempPasswordValidity: Duration.days(1)
      },
      mfa: Mfa.REQUIRED,
      mfaSecondFactor: { otp: true, sms: false },
      accountRecovery: AccountRecovery.EMAIL_ONLY,
      deletionProtection: config.enableDeletionProtection,
      removalPolicy: config.environmentName === "prod" ? RemovalPolicy.RETAIN : RemovalPolicy.DESTROY
    });

    this.operatorPool.addDomain("OperatorDomain", {
      cognitoDomain: { domainPrefix: `tempo-${config.environmentName}-ops-${config.accountId}` }
    });

    this.platformAdminWebClient = this.addBrowserClient(this.operatorPool, "OperatorPlatformAdminWebClient", {
      clientName: resourceName(config, "operators-platform-admin-web"),
      callbackUrls: config.cognitoCallbackUrls.platformAdminWeb,
      logoutUrls: config.cognitoLogoutUrls.platformAdminWeb,
      accessTokenValidity: Duration.minutes(15),
      refreshTokenValidity: Duration.hours(12)
    });

    applyStandardTags(this, config, "identity", "Confidential");
  }

  private addBrowserClient(
    userPool: UserPool,
    id: string,
    props: {
      clientName: string;
      callbackUrls: readonly string[];
      logoutUrls: readonly string[];
      accessTokenValidity?: Duration;
      refreshTokenValidity?: Duration;
      adminUserPassword?: boolean;
      extraScopes?: readonly OAuthScope[];
      readAttributes?: ClientAttributes;
      writeAttributes?: ClientAttributes;
    }
  ): UserPoolClient {
    return new UserPoolClient(this, id, {
      userPool,
      userPoolClientName: props.clientName,
      // Browser-based public clients never receive a client secret.
      generateSecret: false,
      // The apps sign in only through the Hosted UI (authorization code), so no direct password or SRP flow is
      // open to the browser (#124). Refresh stays; the admin-only password flow is for the dev smoke test.
      authFlows: { userSrp: false, adminUserPassword: props.adminUserPassword ?? false },
      preventUserExistenceErrors: true,
      oAuth: {
        flows: { authorizationCodeGrant: true },
        scopes: [OAuthScope.OPENID, OAuthScope.EMAIL, OAuthScope.PROFILE, ...(props.extraScopes ?? [])],
        callbackUrls: [...props.callbackUrls],
        logoutUrls: [...props.logoutUrls]
      },
      readAttributes: props.readAttributes,
      writeAttributes: props.writeAttributes,
      accessTokenValidity: props.accessTokenValidity ?? Duration.hours(1),
      idTokenValidity: props.accessTokenValidity ?? Duration.hours(1),
      refreshTokenValidity: props.refreshTokenValidity ?? Duration.days(30)
    });
  }
}
