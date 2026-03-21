Param(
  [Parameter(Mandatory=$true)][string]$ProjectRef,
  [Parameter(Mandatory=$true)][string]$PgConn
)

if (-not (Get-Command supabase -ErrorAction SilentlyContinue)) {
  Write-Error "supabase CLI not found. Install from https://supabase.com/docs/guides/cli"
  exit 1
}
if (-not (Get-Command psql -ErrorAction SilentlyContinue)) {
  Write-Error "psql not found. Install PostgreSQL client tools."
  exit 1
}

Write-Host "Linking supabase CLI to project $ProjectRef"
supabase link --project-ref $ProjectRef

Write-Host "Applying SQL migrations from supabase/migrations/"
Get-ChildItem -Path "$(Resolve-Path ..\supabase\migrations).Path" -Filter *.sql | Sort-Object Name | ForEach-Object {
  Write-Host "-- Applying: $($_.FullName)"
  psql $PgConn -f $_.FullName
}

Write-Host "Deploying Edge Functions: agora-token, send-call-push, billing-*"
supabase functions deploy agora-token --project-ref $ProjectRef
supabase functions deploy send-call-push --project-ref $ProjectRef
supabase functions deploy billing-create-checkout-session --project-ref $ProjectRef
supabase functions deploy billing-create-portal-session --project-ref $ProjectRef
supabase functions deploy billing-webhook --project-ref $ProjectRef

Write-Host "To set secrets run (example):"
Write-Host "  supabase secrets set AGORA_APP_ID=<id> --project-ref $ProjectRef"
Write-Host "  supabase secrets set STRIPE_SECRET_KEY=<key> STRIPE_WEBHOOK_SECRET=<whsec_...> STRIPE_PRICE_BOOST_MONTHLY=<price_id> --project-ref $ProjectRef"
