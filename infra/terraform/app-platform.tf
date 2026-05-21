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
      # source_dir = "/" (repo root) is required so App Platform's buildpack
      # finds the root pnpm-lock.yaml and uses pnpm. Setting source_dir to a
      # subdirectory makes the buildpack treat that subdir as the project root,
      # which: (a) doesn't find pnpm-lock.yaml and falls back to npm, and
      # (b) npm doesn't understand pnpm's "workspace:*" dependency syntax.
      # The build_command then filters down to just the dashboard.
      source_dir         = "/"
      # --prod=false forces pnpm to install devDependencies even when
      # NODE_ENV=production is set somewhere upstream. Next.js builds need
      # @tailwindcss/postcss, TypeScript, @agenticos/tsconfig, etc. — all
      # devDeps. Without this flag pnpm skips them and the build fails with
      # "Cannot find module '@tailwindcss/postcss'" + tsconfig resolution errors.
      build_command      = "pnpm install --frozen-lockfile --prod=false && pnpm --filter @agenticos/dashboard build"
      run_command        = "pnpm --filter @agenticos/dashboard start"

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
        # RUN_TIME scope only — NOT RUN_AND_BUILD_TIME. At BUILD time we
        # need devDependencies (TS, postcss plugins, workspace tsconfig)
        # which pnpm skips when NODE_ENV=production is set during install.
        # Next.js itself reads NODE_ENV at runtime to enable production mode.
        value = "production"
        scope = "RUN_TIME"
      }
    }
  }
}
