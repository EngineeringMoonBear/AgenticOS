# DigitalOcean App Platform — Next.js dashboard.
#
# VPC attachment: App Platform talks to the Droplet over the private DO VPC.
# The provider's `spec.vpc { id = ... }` block (added in 2.5x+) does this
# natively — earlier versions required a one-time UI step. We're now pinned
# to the latest 2.x which has the field.

resource "digitalocean_app" "dashboard" {
  spec {
    name   = "agenticos-dashboard"
    region = var.do_region

    # Attach to the VPC where the Droplet lives so the App's HONCHO_URL
    # (pointing at the Droplet's VPC-private IP) is reachable. Without
    # VPC attachment, App Platform reaches Honcho only via the public IP
    # which is firewalled.
    vpc {
      id = digitalocean_vpc.agenticos.id
    }

    # Custom domain so App Platform serves traffic for the Cloudflare-proxied
    # hostname. Without this, App Platform would reject requests with this
    # Host header. Domain ownership is verified via the Cloudflare CNAME that
    # already exists (see cloudflare-dns.tf).
    domain {
      name = var.domain
      type = "PRIMARY"
    }

    service {
      name               = "dashboard"
      instance_count     = 1
      instance_size_slug = "basic-xxs"
      http_port          = 3000
      # source_dir = "/" (repo root) is required so App Platform's buildpack
      # finds the root pnpm-lock.yaml and uses pnpm. Setting source_dir to a
      # subdirectory makes the buildpack treat that subdir as the project root,
      # which: (a) doesn't find pnpm-lock.yaml and falls back to npm, and
      # (b) npm doesn't understand pnpm's "workspace:*" dependency syntax.
      # The build_command then filters down to just the dashboard.
      source_dir = "/"
      # --prod=false forces pnpm to install devDependencies even when
      # NODE_ENV=production is set somewhere upstream. Next.js builds need
      # @tailwindcss/postcss, TypeScript, @agenticos/tsconfig, etc. — all
      # devDeps. Without this flag pnpm skips them and the build fails with
      # "Cannot find module '@tailwindcss/postcss'" + tsconfig resolution errors.
      build_command = "pnpm install --frozen-lockfile --prod=false && pnpm --filter @agenticos/dashboard build"
      run_command   = "pnpm --filter @agenticos/dashboard start"

      github {
        repo           = var.github_repo
        branch         = var.github_branch
        deploy_on_push = true
      }

      # ---------------------------------------------------------------------
      # Droplet-private endpoints. App Platform is attached to the same
      # `digitalocean_vpc.agenticos` VPC (see the `vpc { ... }` block above),
      # so the Droplet's `ipv4_address_private` (10.10.0.x in the agenticos
      # VPC) is reachable as a Layer-3 destination from App Platform's
      # container.
      #
      # For these to actually answer, the Droplet's docker-compose must bind
      # the matching ports on the VPC interface (not 127.0.0.1). See the
      # PR body and ops runbook for the matching docker-compose edit.
      #
      # Honcho was the v1 memory service; it was retired during the v2 pivot
      # to OpenViking and no longer runs anywhere. The previous HONCHO_URL
      # block has been removed.
      # ---------------------------------------------------------------------

      env {
        key   = "AGENTICOS_DB_URL"
        value = "postgresql://agenticos:${var.agenticos_db_password}@${digitalocean_droplet.agenticos_droplet.ipv4_address_private}:5432/agenticos"
        scope = "RUN_TIME"
        type  = "SECRET"
      }

      env {
        key   = "OPENVIKING_ENDPOINT"
        value = "http://${digitalocean_droplet.agenticos_droplet.ipv4_address_private}:1933"
        scope = "RUN_TIME"
      }

      env {
        key   = "OPENVIKING_API_KEY"
        value = var.openviking_root_api_key
        scope = "RUN_TIME"
        type  = "SECRET"
      }

      env {
        # Tenant header sent on every Viking call (X-OpenViking-Account)
        # via the dashboard's lib/api/viking.ts shim. Matches the value
        # used by Hermes' OpenViking plugin in the Droplet's compose file.
        key   = "OPENVIKING_ACCOUNT"
        value = "agenticos"
        scope = "RUN_TIME"
      }

      env {
        # Tenant-user header for every Viking call (X-OpenViking-User).
        key   = "OPENVIKING_USER"
        value = "deploy"
        scope = "RUN_TIME"
      }

      env {
        key = "NODE_ENV"
        # RUN_TIME scope only — NOT RUN_AND_BUILD_TIME. At BUILD time we
        # need devDependencies (TS, postcss plugins, workspace tsconfig)
        # which pnpm skips when NODE_ENV=production is set during install.
        # Next.js itself reads NODE_ENV at runtime to enable production mode.
        value = "production"
        scope = "RUN_TIME"
      }

      env {
        # The dashboard's DNS-rebinding-protection middleware (apps/dashboard/proxy.ts)
        # checks request Host against an allowlist. App Platform's *.ondigitalocean.app
        # pattern is handled by a regex in code; the custom Cloudflare-fronted domain
        # has to be listed explicitly here.
        key   = "ALLOWED_HOSTS"
        value = var.domain
        scope = "RUN_TIME"
      }
    }
  }
}
