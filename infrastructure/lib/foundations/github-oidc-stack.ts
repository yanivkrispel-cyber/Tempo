import { Stack, StackProps } from "aws-cdk-lib";
import { FederatedPrincipal, OpenIdConnectProvider, PolicyStatement, Role } from "aws-cdk-lib/aws-iam";
import { Construct } from "constructs";
import { TempoEnvironmentConfig, resourceName } from "../../config/environment-config";
import { applyStandardTags } from "../constructs/tagging";

const GITHUB_OIDC_URL = "https://token.actions.githubusercontent.com";
const GITHUB_OIDC_AUDIENCE = "sts.amazonaws.com";

export interface GitHubOidcStackProps extends StackProps {
  readonly config: TempoEnvironmentConfig;
}

/**
 * GitHub Actions OIDC federation and the per-environment deployment role
 * (ADR-0011). No static AWS access keys are used anywhere in CI/CD.
 *
 * NOTE: an AWS account may only register one OIDC provider per issuer URL.
 * If `token.actions.githubusercontent.com` is already registered in this
 * account (e.g. by another project), replace the `new OpenIdConnectProvider`
 * call below with
 * `OpenIdConnectProvider.fromOpenIdConnectProviderArn(this, "GitHubOidcProvider", "<existing-arn>")`.
 */
export class GitHubOidcStack extends Stack {
  public readonly deploymentRole: Role;

  constructor(scope: Construct, id: string, props: GitHubOidcStackProps) {
    super(scope, id, props);
    const { config } = props;

    const provider = new OpenIdConnectProvider(this, "GitHubOidcProvider", {
      url: GITHUB_OIDC_URL,
      clientIds: [GITHUB_OIDC_AUDIENCE]
    });

    // Trust is restricted to this exact repository and the exact branch (or
    // GitHub Environment, for protected production approval) permitted to
    // deploy this environment - never every branch or every repository.
    const subClaim = config.github.githubEnvironment
      ? `repo:${config.github.owner}/${config.github.repo}:environment:${config.github.githubEnvironment}`
      : `repo:${config.github.owner}/${config.github.repo}:ref:refs/heads/${config.github.allowedBranch}`;

    this.deploymentRole = new Role(this, "DeploymentRole", {
      roleName: resourceName(config, "github-deploy"),
      description: `Assumed by GitHub Actions to deploy the ${config.environmentName} environment via OIDC`,
      assumedBy: new FederatedPrincipal(
        provider.openIdConnectProviderArn,
        {
          StringEquals: { [`${GITHUB_OIDC_URL.replace("https://", "")}:aud`]: GITHUB_OIDC_AUDIENCE },
          StringLike: { [`${GITHUB_OIDC_URL.replace("https://", "")}:sub`]: subClaim }
        },
        "sts:AssumeRoleWithWebIdentity"
      )
    });

    // CDK deploy needs to assume the CDK bootstrap roles (file publishing,
    // deploy, lookup) for this account/region; those roles already enforce
    // their own least-privilege boundary (scoped to the bootstrap qualifier),
    // so granting AssumeRole on them - rather than raw account-wide
    // permissions - keeps this role scoped. No other permissions are needed:
    // `cdk deploy` performs CloudFormation actions using credentials from the
    // assumed deploy role, not this role's own identity.
    this.deploymentRole.addToPolicy(
      new PolicyStatement({
        sid: "AssumeCdkBootstrapRoles",
        actions: ["sts:AssumeRole"],
        resources: [`arn:aws:iam::${config.accountId}:role/cdk-*`]
      })
    );

    applyStandardTags(this, config, "github-oidc");
  }
}
