# DigitalOcean App Platform — Next.js dashboard.
#
# VPC attachment: App Platform talks to the Droplet over the private DO VPC.
# The provider's `spec.vpc { id = ... }` block (added in 2.5x+) does this
# natively — earlier versions required a one-time UI step. We're now pinned
# to the latest 2.x which has the field.

resource "digitalocean_app" "dashboard" {
  spec {
    name = "agenticos-dashboard"
    # App Platform region slugs are datacenter-group slugs ("nyc", "sfo", "fra"),
    # NOT the Droplet/Spaces slugs ("nyc1"/"nyc3"). Using var.do_region (="nyc1")
    # here caused a permanent plan diff: DO stores/returns "nyc" for the app, so
    # TF re-proposed nyc->nyc1 on every plan and it never converged. Pin the
    # App Platform slug explicitly. Same physical NYC datacenter group as the
    # Droplet's nyc1 — colocated for VPC-private reachability.
    region = "nyc"

    # Attach to the VPC where the Droplet lives so the App can reach the
    # Droplet's VPC-private services (Paperclip :3100, OpenViking :1933,
    # Postgres :5432) at their private IPs. Without VPC attachment, those
    # are reachable only via the firewalled public IP.
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
      name = "dashboard"

      # Horizontal autoscale (GOL-256 / GOL-241 Tier 1, board decision D1).
      #
      # App Platform can only autoscale on a *dedicated* ("professional-*")
      # instance size — the shared "basic-*" tiers are fixed-count — so the
      # floor moves from basic-xxs ($5/mo fixed) up to professional-xs
      # (~$29/mo), scaling to ~$87/mo at 3 instances under sustained CPU.
      # The dashboard is stateless (all state lives on the Droplet/Postgres
      # over the VPC), so replicas are interchangeable and scaling is
      # zero-downtime.
      #
      # `instance_count` is intentionally REMOVED: when an `autoscaling`
      # block is present the App Platform API owns the live replica count,
      # and leaving a static `instance_count` here yields a perpetual plan
      # diff (DO returns the autoscaled count, TF keeps re-proposing 1) —
      # the same never-converging-diff failure mode documented for `region`
      # above. `min_instance_count` is the new floor.
      #
      # ROLLBACK: delete this `autoscaling` block and restore
      #   instance_count = 1 / instance_size_slug = "basic-xxs"
      # then re-apply — reverts to the $5/mo fixed single instance.
      instance_size_slug = "professional-xs"
      autoscaling {
        min_instance_count = 1
        max_instance_count = 3
        metrics {
          cpu {
            percent = 70
          }
        }
      }
      http_port = 3000
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
      # so the Droplet's `ipv4_address_private` (10.116.16.2 in the agenticos
      # VPC 10.116.16.0/20) is reachable as a Layer-3 destination from App Platform's
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
        # used by the OpenViking plugin in the Droplet's compose file.
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
        # vault-server (Phase B) over the VPC. store-singleton.ts instantiates a
        # RemoteVaultClient when this is set; absent locally -> local InMemoryVaultStore.
        key   = "VAULT_SERVER_URL"
        value = "http://${digitalocean_droplet.agenticos_droplet.ipv4_address_private}:7779"
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
        # The dashboard's host-allowlist layer (apps/dashboard/proxy.ts) checks
        # request Host against this list. ONLY the Cloudflare-fronted custom
        # domain belongs here — the *.ondigitalocean.app default URL is
        # deliberately NOT allowed (it bypasses Cloudflare Access; security
        # review 2026-07-12, H1).
        key   = "ALLOWED_HOSTS"
        value = var.domain
        scope = "RUN_TIME"
      }

      # ---------------------------------------------------------------------
      # Cloudflare Access JWT verification (security review 2026-07-12, H1).
      # proxy.ts requires every /api/* request on a non-local host to carry a
      # valid Cf-Access-Jwt-Assertion. Issuer = the Zero Trust team domain;
      # audience = the Access application's AUD tag, exported by the
      # cloudflare_zero_trust_access_application resource — so this stays in
      # lockstep with the Access app, no hand-copied values. proxy.ts FAILS
      # CLOSED (503 on /api/*) if these are missing in production.
      # ---------------------------------------------------------------------

      env {
        key   = "CF_ACCESS_TEAM_DOMAIN"
        value = var.cloudflare_access_team_domain
        scope = "RUN_TIME"
      }

      env {
        key   = "CF_ACCESS_AUD"
        value = cloudflare_zero_trust_access_application.dashboard.aud
        scope = "RUN_TIME"
      }

      # ---------------------------------------------------------------------
      # Paperclip integration (data-source repoint).
      #
      # PAPERCLIP_API_URL — Paperclip server on the private VPC. App Platform
      #   is attached to the same `digitalocean_vpc.agenticos` VPC so the
      #   Droplet's private IP (10.116.16.2) is reachable at Layer 3.
      #
      # PAPERCLIP_COMPANY_ID — The UUID of the GOL company row in Paperclip's
      #   `companies` table. Read from 1Password at apply time:
      #     TF_VAR_paperclip_company_id=$(op read "op://Goldberry Grove - Admin/AgenticOS Infra/paperclip_company_id")
      #
      # PAPERCLIP_BOARD_KEY — Board API key; sent as `Authorization: Bearer`
      #   on every Paperclip request. Same 1Password apply-time pattern as
      #   openviking_root_api_key. Stored as a DigitalOcean secret env var.
      #
      # DASHBOARD_DATA_SOURCE = "paperclip" is the cutover flip (D3): every
      #   dashboard route reads Paperclip instead of Hermes. ROLLBACK: set this
      #   to "hermes" (or delete the block) and re-apply — instant revert.
      # ---------------------------------------------------------------------

      env {
        key = "PAPERCLIP_API_URL"
        # Interpolate the Droplet's VPC-private IP like the co-located services
        # (AGENTICOS_DB_URL / OPENVIKING_* / VAULT_SERVER_URL) rather than
        # hardcoding 10.116.16.2. Renders to the same value today, but on a
        # Droplet recreate this auto-tracks the new IP instead of going stale
        # and silently cutting the dashboard's data source after cutover.
        value = "http://${digitalocean_droplet.agenticos_droplet.ipv4_address_private}:3100"
        scope = "RUN_TIME"
      }

      env {
        key   = "PAPERCLIP_COMPANY_ID"
        value = var.paperclip_company_id
        scope = "RUN_TIME"
      }

      env {
        key   = "PAPERCLIP_BOARD_KEY"
        value = var.paperclip_board_key
        scope = "RUN_TIME"
        type  = "SECRET"
      }

      # Cutover flip (D3). Roll back by setting "hermes" or deleting this block.
      env {
        key   = "DASHBOARD_DATA_SOURCE"
        value = "paperclip"
        scope = "RUN_TIME"
      }
    }
  }
}
