output "bucket_name" {
  description = "Name of the state bucket. Use this in infra/terraform/main.tf's backend block as `bucket = \"...\"`."
  value       = digitalocean_spaces_bucket.tf_state.name
}

output "bucket_endpoint" {
  description = "S3-compatible endpoint for the root backend block as `endpoint = \"...\"`."
  value       = "https://${var.region}.digitaloceanspaces.com"
}

output "state_key" {
  description = "Reminder of the object key the root backend writes to. Set in infra/terraform/main.tf, repeated here for the migration runbook."
  value       = "foundation-v2/terraform.tfstate"
}

output "github_secrets_synced" {
  description = "Names of the GitHub Actions secrets this module wrote. Values are masked in tfstate (sensitive=true on the provider attributes) and not echoed here."
  value       = keys(local.gh_secrets)
}

output "spaces_key_name" {
  description = "Name of the bucket-scoped Spaces access key, for cross-referencing in the DO Cloud Panel if you need to inspect or rotate."
  value       = digitalocean_spaces_key.tf_state_rw.name
}
