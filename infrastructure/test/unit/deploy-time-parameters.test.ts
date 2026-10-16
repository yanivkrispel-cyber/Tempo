import { Stack } from "aws-cdk-lib";
import { Template } from "aws-cdk-lib/assertions";
import { describe, expect, it } from "vitest";
import { dev, prod } from "./helpers/synth";

/**
 * The web push keys are written by a person (tools/scripts/vapid-keys.mjs), possibly after the deploy; the stacks
 * only name them and grant access. A template parameter of type AWS::SSM::Parameter::Value would make
 * CloudFormation read the value at deploy time, so a deploy before the keys exist fails (the dev deploy of 4fda9db
 * on board #176).
 */
describe("no stack reads a push key at deploy time", () => {
  for (const [name, app] of [["dev", dev], ["prod", prod]] as const) {
    for (const child of app.node.children.filter(Stack.isStack)) {
      it(`${name} ${child.node.id}`, () => {
        const parameters = Template.fromStack(child).toJSON().Parameters ?? {};
        const pushValues = Object.values(parameters as Record<string, { Type: string; Default?: string }>).filter(
          (parameter) => parameter.Type.startsWith("AWS::SSM::Parameter::Value") && String(parameter.Default).includes("/push/")
        );
        expect(pushValues).toEqual([]);
      });
    }
  }
});
