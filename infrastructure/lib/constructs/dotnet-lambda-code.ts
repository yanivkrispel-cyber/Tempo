import * as fs from "node:fs";
import * as path from "node:path";
import { Code } from "aws-cdk-lib/aws-lambda";

const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");
const PLACEHOLDER_DIR = path.join(__dirname, "placeholder-lambda");

/**
 * Resolves the deployment asset for a .NET Lambda function.
 *
 * `deploy-development.yml` always runs `dotnet lambda package` (via
 * Amazon.Lambda.Tools) before `cdk deploy`, which publishes each Lambda
 * project to `backend/<projectName>/bin/Release/net10.0/linux-arm64/publish`.
 * When that folder exists, it is used directly.
 *
 * When it does not exist - e.g. running `cdk synth`/CDK unit tests on a
 * machine without the .NET SDK installed, or before the first build - a
 * placeholder asset is used instead so the infrastructure can still be
 * synthesized and reviewed. The placeholder is never a working Lambda
 * package; run the backend build first for a real deployment.
 */
export function resolveDotNetLambdaCode(projectName: string): Code {
  const publishDir = path.join(
    REPO_ROOT,
    "backend",
    projectName,
    "bin",
    "Release",
    "net10.0",
    "linux-arm64",
    "publish"
  );

  if (fs.existsSync(publishDir) && fs.readdirSync(publishDir).length > 0) {
    return Code.fromAsset(publishDir);
  }

  return Code.fromAsset(PLACEHOLDER_DIR);
}
