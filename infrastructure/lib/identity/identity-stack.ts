import { Duration, RemovalPolicy, Stack, StackProps } from "aws-cdk-lib";
import { AccountRecovery, Mfa, OAuthScope, UserPool, UserPoolClient } from "aws-cdk-lib/aws-cognito";
import { Construct } from "constructs";
import { TempoEnvironmentConfig, resourceName } from "../../config/environment-config";
import { applyStandardTags } from "../constructs/tagging";

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
 * Known Phase 0 limitation (see completion report): mandatory MFA for
 * platform-admin-web is not enforced per-client here - Cognito applies MFA
 * at the user pool level. Pool-wide MFA is OPTIONAL (TOTP) in this phase;
 * enforcing "MFA required" specifically for platform administrators needs
 * either a pre-token-generation Lambda trigger or a separate user pool, and
 * is deferred to the Identity/Membership LLD phase.
 */
export class IdentityStack extends Stack {
  public readonly userPool: UserPool;
  public readonly adminWebClient: UserPoolClient;
  public readonly clientWebClient: UserPoolClient;
  public readonly platformAdminWebClient: UserPoolClient;

  constructor(scope: Construct, id: string, props: IdentityStackProps) {
    super(scope, id, props);
    const { config } = props;

    this.userPool = new UserPool(this, "UserPool", {
      userPoolName: resourceName(config, "users"),
      selfSignUpEnabled: true,
      signInAliases: { email: true, username: false },
      autoVerify: { email: true },
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

    this.adminWebClient = this.addBrowserClient("AdminWebClient", {
      clientName: resourceName(config, "admin-web"),
      callbackUrls: config.cognitoCallbackUrls.adminWeb,
      logoutUrls: config.cognitoLogoutUrls.adminWeb
    });

    this.clientWebClient = this.addBrowserClient("ClientWebClient", {
      clientName: resourceName(config, "client-web"),
      callbackUrls: config.cognitoCallbackUrls.clientWeb,
      logoutUrls: config.cognitoLogoutUrls.clientWeb
    });

    this.platformAdminWebClient = this.addBrowserClient("PlatformAdminWebClient", {
      clientName: resourceName(config, "platform-admin-web"),
      callbackUrls: config.cognitoCallbackUrls.platformAdminWeb,
      logoutUrls: config.cognitoLogoutUrls.platformAdminWeb
    });

    applyStandardTags(this, config, "identity", "Confidential");
  }

  private addBrowserClient(
    id: string,
    props: { clientName: string; callbackUrls: readonly string[]; logoutUrls: readonly string[] }
  ): UserPoolClient {
    return new UserPoolClient(this, id, {
      userPool: this.userPool,
      userPoolClientName: props.clientName,
      // Browser-based public clients never receive a client secret.
      generateSecret: false,
      authFlows: { userSrp: true },
      preventUserExistenceErrors: true,
      oAuth: {
        flows: { authorizationCodeGrant: true },
        scopes: [OAuthScope.OPENID, OAuthScope.EMAIL, OAuthScope.PROFILE],
        callbackUrls: [...props.callbackUrls],
        logoutUrls: [...props.logoutUrls]
      },
      accessTokenValidity: Duration.hours(1),
      idTokenValidity: Duration.hours(1),
      refreshTokenValidity: Duration.days(30)
    });
  }
}
