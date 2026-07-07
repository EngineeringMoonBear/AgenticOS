terraform {
  required_version = ">= 1.6"

  required_providers {
    digitalocean = {
      source  = "digitalocean/digitalocean"
      version = "~> 2.40"
    }
    github = {
      source  = "integrations/github"
      version = "~> 6.2"
    }
  }

  # LOCAL backend on purpose. This module bootstraps the `agenticos-tfstate`
  # bucket that the ROOT AgenticOS Terraform (infra/terraform/main.tf) uses as
  # its remote backend. Storing this module's own state in that same bucket
  # would be circular, so we keep its state as a small local file.
  #
  # The state file is .gitignored. If lost: every resource here is also visible
  # in the DO Cloud Panel + GitHub Secrets UI; `terraform import` them back.
  # This module manages only a bucket + one scoped key + two GH secrets — cheap
  # to reconstruct, unlike the root state this bucket protects.
  backend "local" {}
}
