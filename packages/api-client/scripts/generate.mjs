// Generates src/generated/schema.ts from the OpenAPI contract (ADR-0024).
//   node scripts/generate.mjs           write the file
//   node scripts/generate.mjs --check   fail if the committed file is out of date (CI)
import { readFile, writeFile } from "node:fs/promises";
import openapiTS, { astToString } from "openapi-typescript";

const contract = new URL("../../../contracts/openapi/tempo-api.v1.yaml", import.meta.url);
const target = new URL("../src/generated/schema.ts", import.meta.url);

const header = `// Generated from contracts/openapi/tempo-api.v1.yaml by \`pnpm --filter @tempo/api-client generate\`.
// Do not edit by hand: CI fails when this file differs from the contract.

`;
const generated = header + astToString(await openapiTS(contract));

// Compare without line endings, so a Windows checkout (CRLF) matches CI (LF).
const normalize = (text) => text.replace(/\r\n/g, "\n");

if (process.argv.includes("--check")) {
  const committed = await readFile(target, "utf8").catch(() => "");
  if (normalize(committed) !== normalize(generated)) {
    console.error("packages/api-client/src/generated/schema.ts is out of date with the contract.");
    console.error("Run: pnpm --filter @tempo/api-client generate, and commit the result.");
    process.exit(1);
  }
  console.log("api-client: generated schema matches the contract.");
} else {
  await writeFile(target, generated);
  console.log("api-client: wrote src/generated/schema.ts");
}
