import { Stack } from "aws-cdk-lib";
import { Template } from "aws-cdk-lib/assertions";
import { describe, expect, it } from "vitest";
import { dev } from "./helpers/synth";

/**
 * Rejects any IAM statement using a bare `"*"` for both Action and Resource
 * (full-admin-equivalent access) unless explicitly allowlisted below with a
 * documented reason. This intentionally does not flag scoped wildcards like
 * `"s3:Get*"` or `"role/cdk-*"` - those are common, narrowly-scoped AWS SDK
 * grants, not the "no wildcard IAM policy" risk this test guards against.
 */
const ALLOWLISTED_LOGICAL_ID_SUBSTRINGS: string[] = [
  // No full "Action: *" / "Resource: *" statement exists in this stage yet.
  // Add an entry here with a one-line justification if one is ever needed.
];

function isFullWildcard(value: unknown): boolean {
  if (typeof value === "string") return value === "*";
  if (Array.isArray(value)) return value.includes("*");
  return false;
}

describe("No unscoped IAM wildcard permissions (LLD section 30/35/36)", () => {
  const stacks = dev.node.findAll().filter(Stack.isStack);

  it.each(stacks.map((s) => [s.node.id, s] as const))("%s has no bare Action:*/Resource:* IAM statement", (id, stack) => {
    const template = Template.fromStack(stack);
    const policies = {
      ...template.findResources("AWS::IAM::Policy"),
      ...template.findResources("AWS::IAM::ManagedPolicy")
    };

    for (const [logicalId, policy] of Object.entries(policies)) {
      if (ALLOWLISTED_LOGICAL_ID_SUBSTRINGS.some((allowed) => logicalId.includes(allowed))) {
        continue;
      }

      const statements = policy.Properties?.PolicyDocument?.Statement ?? [];
      for (const statement of statements) {
        const isFullyWildcarded = isFullWildcard(statement.Action) && isFullWildcard(statement.Resource);
        expect(
          isFullyWildcarded,
          `${id}/${logicalId} has an unscoped Action:* + Resource:* statement: ${JSON.stringify(statement)}`
        ).toBe(false);
      }
    }
  });
});
