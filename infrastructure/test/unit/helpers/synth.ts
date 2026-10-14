import { App } from "aws-cdk-lib";
import cdkJson from "../../../cdk.json";
import developmentConfig from "../../../config/development";
import productionConfig from "../../../config/production";
import { TempoStage } from "../../../lib/tempo-stage";

/**
 * Synthesizes the dev and prod stages once and shares them across every test
 * file (synthesis is not free - dozens of resources per environment). The app
 * gets the context from cdk.json, so tests see the same feature flags as
 * `cdk synth` and fail on the same template validation errors.
 *
 * `devWithEdge` is dev with the edge stack switched on. Dev runs without it
 * until AWS verifies the account for CloudFront, but the edge code must stay
 * tested for dev as well as prod.
 */
function synthesize() {
  const app = new App({ context: cdkJson.context });
  const dev = new TempoStage(app, "TestTempoDev", { config: developmentConfig, buildVersion: "test-sha" });
  const prod = new TempoStage(app, "TestTempoProd", { config: productionConfig, buildVersion: "test-sha" });
  const devWithEdge = new TempoStage(app, "TestTempoDevWithEdge", {
    config: {
      ...developmentConfig,
      featureFlags: { ...developmentConfig.featureFlags, enableFrontendHosting: true, enableWaf: true }
    },
    buildVersion: "test-sha"
  });
  app.synth();
  return { dev, prod, devWithEdge };
}

export const { dev, prod, devWithEdge } = synthesize();
