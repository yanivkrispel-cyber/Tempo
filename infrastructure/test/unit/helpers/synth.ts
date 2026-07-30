import { App } from "aws-cdk-lib";
import developmentConfig from "../../../config/development";
import productionConfig from "../../../config/production";
import { TempoStage } from "../../../lib/tempo-stage";

/**
 * Synthesizes the dev and prod stages once and shares them across every test
 * file (synthesis is not free - dozens of resources per environment).
 */
function synthesize() {
  const app = new App();
  const dev = new TempoStage(app, "TestTempoDev", { config: developmentConfig, buildVersion: "test-sha" });
  const prod = new TempoStage(app, "TestTempoProd", { config: productionConfig, buildVersion: "test-sha" });
  app.synth();
  return { dev, prod };
}

export const { dev, prod } = synthesize();
