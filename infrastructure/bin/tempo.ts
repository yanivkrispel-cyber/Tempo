#!/usr/bin/env node
import "source-map-support/register";
import { App } from "aws-cdk-lib";
import developmentConfig from "../config/development";
import stagingConfig from "../config/staging";
import productionConfig from "../config/production";
import { TempoStage } from "../lib/tempo-stage";

const app = new App();

// Every environment's config is synthesized in one `cdk synth` (LLD section
// 39: "npx cdk synth succeeds for development, staging and production
// configuration"). Each Stage is an independent, separately named set of
// stacks - `cdk deploy` still requires selecting one explicitly
// (e.g. `cdk deploy 'TempoDev/*'`), so this can never deploy every
// environment at once by accident.
const buildVersion = process.env.COMMIT_SHA ?? process.env.GITHUB_SHA ?? "local";

new TempoStage(app, "TempoDev", { config: developmentConfig, buildVersion });
new TempoStage(app, "TempoStg", { config: stagingConfig, buildVersion });
new TempoStage(app, "TempoProd", { config: productionConfig, buildVersion });

app.synth();
