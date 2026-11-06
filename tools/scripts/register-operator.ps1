<#
.SYNOPSIS
  Registers a person as a Tempo operator in one environment (docs/claude-memory/backend-patterns.md, "Operator console").

.DESCRIPTION
  Run by a person, never by an agent: the operator pool requires MFA, and the operators table row is written by the
  owner in the Neon SQL editor.

  1. Creates the user in tempo-<env>-operators (or reuses it) with a verified email. Cognito emails a temporary
     password.
  2. Reads the user's sub.
  3. Prints the INSERT for platform_admin.operators to paste into the Neon SQL editor as the owner.

  The first sign-in asks for a new password. MFA is required on the staging and production operator pools; on dev it
  is optional since #316 (set up TOTP anyway). There is no operator app yet: sign in with
  tools/scripts/operator-token.mjs, which runs one command with the token (docs/runbooks/kris-pilot-steps.md).

  -DryRun only reads: it finds the pool, says whether the user is there and prints its sub. It creates nothing.

.EXAMPLE
  .\tools\scripts\register-operator.ps1 -Email operator@example.com -DryRun
#>
param(
  [Parameter(Mandatory = $true)][string]$Email,
  [switch]$DryRun,
  [string]$Environment = "dev",
  [string]$AwsProfile = "tempo",
  [string]$Region = "eu-central-1"
)

$ErrorActionPreference = "Stop"
$poolName = "tempo-$Environment-operators"

$pool = aws cognito-idp list-user-pools --max-results 20 --profile $AwsProfile --region $Region `
  --query "UserPools[?Name=='$poolName'].Id" --output text
if (-not $pool -or $pool -eq "None") { throw "User pool $poolName not found. Is the Identity stack deployed?" }

# The pool signs in by email, so admin-get-user takes the address as the username. (A list-users --filter with quotes
# inside lost them on the way to aws.exe under Windows PowerShell 5.1, so an existing user was never found.)
$existing = $null
try {
  $ErrorActionPreference = "Continue"
  $found = aws cognito-idp admin-get-user --user-pool-id $pool --username $Email --profile $AwsProfile --region $Region `
    --query "Username" --output text 2>$null
  if ($LASTEXITCODE -eq 0) { $existing = $found }
} catch {
  $existing = $null
} finally {
  $ErrorActionPreference = "Stop"
}
if ($DryRun) {
  if (-not $existing -or $existing -eq "None") {
    Write-Host "Dry run: $Email is not in $poolName (pool $pool). Without -DryRun it would be created."
    exit 0
  }
  $dryStatus = aws cognito-idp admin-get-user --user-pool-id $pool --username $Email --profile $AwsProfile --region $Region `
    --query "UserStatus" --output text
  $drySub = aws cognito-idp admin-get-user --user-pool-id $pool --username $Email --profile $AwsProfile --region $Region `
    --query "UserAttributes[?Name=='sub'].Value" --output text
  Write-Host "Dry run: $Email is in $poolName (pool $pool), status $dryStatus, sub $drySub."
  Write-Host "Check in the Neon SQL editor: SELECT status FROM platform_admin.operators WHERE subject = '$drySub';"
  exit 0
}

if (-not $existing -or $existing -eq "None") {
  aws cognito-idp admin-create-user --user-pool-id $pool --username $Email `
    --user-attributes Name=email,Value=$Email Name=email_verified,Value=true `
    --profile $AwsProfile --region $Region --query "User.UserStatus" --output text | Out-Null
  Write-Host "Created $Email in $poolName. Cognito emailed a temporary password."
} else {
  Write-Host "$Email already exists in $poolName; reusing it."
}

$sub = aws cognito-idp admin-get-user --user-pool-id $pool --username $Email --profile $AwsProfile --region $Region `
  --query "UserAttributes[?Name=='sub'].Value" --output text
$issuer = "https://cognito-idp.$Region.amazonaws.com/$pool"
$sqlEmail = $Email -replace "'", "''"

Write-Host ""
Write-Host "Paste this into the Neon SQL editor ($Environment database), as the owner:"
Write-Host ""
Write-Host "INSERT INTO platform_admin.operators (id, email, issuer, subject, status, created_at, updated_at)"
Write-Host "VALUES (uuidv7(), '$sqlEmail', '$issuer', '$sub', 'active', now(), now());"
