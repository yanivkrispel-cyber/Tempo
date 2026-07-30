import { Stack, StackProps } from "aws-cdk-lib";
import { EventBus } from "aws-cdk-lib/aws-events";
import { Construct } from "constructs";
import { TempoEnvironmentConfig, resourceName } from "../../config/environment-config";
import { applyStandardTags } from "../constructs/tagging";

export interface EventsStackProps extends StackProps {
  readonly config: TempoEnvironmentConfig;
}

/**
 * Custom EventBridge bus (ADR-0008, LLD section 16). Rules that target
 * resources needing a resource-based policy (like the smoke-test SQS queue)
 * are defined alongside that resource, not here - see MessagingStack's
 * SmokeTestRule. A rule bound to a cross-stack SQS target adds a queue
 * policy conditioned on the rule's ARN; if the rule and queue lived in
 * different stacks with the rule's stack depending on the queue (for the
 * target ARN) while the queue's stack depended on the rule (for the policy
 * condition), CDK would reject it as a circular stack dependency.
 */
export class EventsStack extends Stack {
  public readonly eventBus: EventBus;

  constructor(scope: Construct, id: string, props: EventsStackProps) {
    super(scope, id, props);
    const { config } = props;

    this.eventBus = new EventBus(this, "EventBus", {
      eventBusName: resourceName(config, "events")
    });

    applyStandardTags(this, config, "events");
  }
}
