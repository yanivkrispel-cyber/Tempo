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

  The first sign-in to the operator app asks for a new password and sets a TOTP device.

.EXAMPLE
  .\tools\scripts\register-operator.ps1 -Email yaniv.krispel@gmail.com
#>
param(
  [Parameter(Mandatory = $true)][string]$Email,
  [string]$Environment = "dev",
  [string]$AwsProfile = "tempo",
  [string]$Region = "eu-central-1"
)

$ErrorActionPreference = "Stop"
$poolName = "tempo-$Environment-operators"

$pool = aws cognito-idp list-user-pools --max-results 20 --profile $AwsProfile --region $Region `
  --query "UserPools[?Name=='$poolName'].Id" --output text
if (-not $pool -or $pool -eq "None") { throw "User pool $poolName not found. Is the Identity stack deployed?" }

$existing = aws cognito-idp list-users --user-pool-id $pool --filter "email = `"$Email`"" --profile $AwsProfile `
  --region $Region --query "Users[0].Username" --output text
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
