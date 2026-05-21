# DigitalOcean App Platform — Next.js dashboard.
#
# NOTE: At the time of writing, the digitalocean provider (v2.40.x) does not expose
# a `vpc_uuid` attribute on `digitalocean_app`. Attaching the App to the VPC so it can
# reach the Droplet over the private network is a one-time UI step:
#   DO Console → Apps → agenticos-dashboard → Settings → VPC → select agenticos-vpc
# Until then, set HONCHO_URL to the Droplet's *Tailscale* hostname or public IP
# behind the firewall allowlist as a fallback.

resource "digitalocean_app" "dashboard" {
  spec {
    name   = "agenticos-dashboard"
    region = var.do_region

    service {
      name               = "dashboard"
      instance_count     = 1
      instance_size_slug = "basic-xxs"
      http_port          = 3000
      source_dir         = "apps/dashboard"
      build_command      = "cd ../.. && pnpm install --frozen-lockfile && pnpm --filter @agenticos/dashboard build"
      run_command        = "cd ../.. && pnpm --filter @agenticos/dashboard start"

      github {
        repo           = var.github_repo
        branch         = var.github_branch
        deploy_on_push = true
      }

      env {
        key   = "HONCHO_URL"
        value = "http://${digitalocean_droplet.agenticos_droplet.ipv4_address_private}:8000"
        scope = "RUN_AND_BUILD_TIME"
      }

      env {
        key   = "NODE_ENV"
        value = "production"
        scope = "RUN_AND_BUILD_TIME"
      }
    }
  }
}
