#cloud-config
# AgenticOS Droplet bootstrap.
# Templated by Terraform: receives ts_authkey, github_repo, deploy_pubkey.

package_update: true
package_upgrade: true
packages:
  - curl
  - git
  - vim
  - ufw
  - unattended-upgrades
  - fail2ban
  - jq
  - bc
  - ca-certificates
  - apt-transport-https
  - gnupg

users:
  - name: deploy
    sudo: "ALL=(ALL) NOPASSWD: /bin/systemctl, /usr/sbin/ufw"
    shell: /bin/bash
    groups: [sudo]
    ssh_authorized_keys:
      - ${deploy_pubkey}

write_files:
  - path: /etc/apt/keyrings/.placeholder
    content: "placeholder so keyrings dir exists before runcmd"
    permissions: "0644"

  - path: /etc/systemd/system/agenticos-curator.service
    permissions: "0644"
    content: |
      [Unit]
      Description=AgenticOS Curator nightly run
      After=network-online.target docker.service
      Wants=network-online.target

      [Service]
      Type=oneshot
      User=deploy
      WorkingDirectory=/opt/agenticos/repo
      ExecStart=/bin/bash -lc '/opt/agenticos/repo/scripts/run-curator.sh'
      StandardOutput=append:/var/log/agenticos/curator.log
      StandardError=append:/var/log/agenticos/curator.log

      [Install]
      WantedBy=multi-user.target

  - path: /etc/systemd/system/agenticos-curator.timer
    permissions: "0644"
    content: |
      [Unit]
      Description=Run AgenticOS Curator nightly at 03:00 local

      [Timer]
      OnCalendar=*-*-* 03:00:00
      Persistent=true
      Unit=agenticos-curator.service

      [Install]
      WantedBy=timers.target

  - path: /etc/systemd/system/agenticos-pg-backup.service
    permissions: "0644"
    content: |
      [Unit]
      Description=AgenticOS Postgres backup (cost telemetry + task ledger)
      After=network-online.target docker.service
      Wants=network-online.target

      [Service]
      Type=oneshot
      User=deploy
      WorkingDirectory=/opt/agenticos/repo
      ExecStart=/bin/bash -lc '/opt/agenticos/repo/infra/scripts/pg-backup.sh'
      StandardOutput=append:/var/log/agenticos/pg-backup.log
      StandardError=append:/var/log/agenticos/pg-backup.log

      [Install]
      WantedBy=multi-user.target

  - path: /etc/systemd/system/agenticos-pg-backup.timer
    permissions: "0644"
    content: |
      [Unit]
      Description=Run AgenticOS Postgres backup daily at 04:00 local

      [Timer]
      OnCalendar=*-*-* 04:00:00
      Persistent=true
      Unit=agenticos-pg-backup.service

      [Install]
      WantedBy=timers.target

  - path: /etc/systemd/system/agenticos-viking-backup.service
    permissions: "0644"
    content: |
      [Unit]
      Description=AgenticOS OpenViking memory backup (native pack/backup → .ovpack)
      After=network-online.target docker.service
      Wants=network-online.target

      [Service]
      Type=oneshot
      User=deploy
      WorkingDirectory=/opt/agenticos/repo
      ExecStart=/bin/bash -lc '/opt/agenticos/repo/infra/scripts/viking-backup.sh'
      StandardOutput=append:/var/log/agenticos/viking-backup.log
      StandardError=append:/var/log/agenticos/viking-backup.log

      [Install]
      WantedBy=multi-user.target

  - path: /etc/systemd/system/agenticos-viking-backup.timer
    permissions: "0644"
    content: |
      [Unit]
      Description=Run AgenticOS OpenViking memory backup daily at 04:30 local

      [Timer]
      OnCalendar=*-*-* 04:30:00
      Persistent=true
      Unit=agenticos-viking-backup.service

      [Install]
      WantedBy=timers.target

  # Drop-in override for the syncthing@deploy.service unit. By default
  # Syncthing's GUI binds to 127.0.0.1:8384 (loopback only), which means
  # even with UFW open on tailscale0 the GUI is unreachable from the
  # Mac on the Tailnet. The STGUIADDRESS env var overrides the config.xml
  # bind setting BEFORE Syncthing's first run, so we never have to edit
  # config.xml or restart the service to fix the bind. This file lives
  # at /etc/systemd/system/syncthing@deploy.service.d/override.conf and
  # is systemd's canonical way to extend a stock unit without modifying
  # the package-installed unit file.
  - path: /etc/systemd/system/syncthing@deploy.service.d/override.conf
    permissions: "0644"
    content: |
      [Service]
      Environment=STGUIADDRESS=0.0.0.0:8384

      [Install]
      WantedBy=timers.target

runcmd:
  # --- SSH hardening ---
  - sed -i 's/^#*PermitRootLogin.*/PermitRootLogin no/' /etc/ssh/sshd_config
  - sed -i 's/^#*PasswordAuthentication.*/PasswordAuthentication no/' /etc/ssh/sshd_config
  - systemctl restart ssh

  # --- UFW baseline ---
  - ufw default deny incoming
  - ufw default allow outgoing
  - ufw allow 22/tcp
  - ufw --force enable

  # --- Docker Engine ---
  - curl -fsSL https://get.docker.com | sh
  - usermod -aG docker deploy

  # --- Tailscale (joins with auth key, no browser interaction) ---
  - curl -fsSL https://tailscale.com/install.sh | sh
  - tailscale up --authkey=${ts_authkey} --hostname=agenticos-droplet --ssh --accept-routes

  # --- Syncthing ---
  - mkdir -p /etc/apt/keyrings
  - curl -fsSL -o /etc/apt/keyrings/syncthing-archive-keyring.gpg https://syncthing.net/release-key.gpg
  - echo "deb [signed-by=/etc/apt/keyrings/syncthing-archive-keyring.gpg] https://apt.syncthing.net/ syncthing stable" > /etc/apt/sources.list.d/syncthing.list
  - apt-get update
  - DEBIAN_FRONTEND=noninteractive apt-get install -y syncthing
  - loginctl enable-linger deploy
  # Reload systemd so it picks up the syncthing@deploy.service drop-in
  # (Environment=STGUIADDRESS=0.0.0.0:8384) we wrote in write_files above.
  # Without reload, the drop-in exists on disk but the unit cache doesn't
  # know about it. Then enable+start applies the env var on first boot,
  # so Syncthing binds to 0.0.0.0:8384 from the very first run — no need
  # to edit config.xml or restart later.
  - systemctl daemon-reload
  - systemctl enable --now syncthing@deploy.service
  - ufw allow in on tailscale0 to any port 8384 proto tcp

  # --- Node 22 + pnpm ---
  - curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  - DEBIAN_FRONTEND=noninteractive apt-get install -y nodejs
  - npm install -g pnpm@9.15.4

  # --- Claude Code (OAuth login is a manual one-time step after this) ---
  # Install as the deploy user with a user-scoped npm prefix so auto-updates
  # work without sudo.  Root-global npm installs (which is what `npm install
  # -g` does by default) put the binary at /usr/lib/node_modules/... owned by
  # root, and Claude Code's self-update logic can't write there as deploy.
  # User-scoped prefix → deploy owns its npm-managed binaries → updates work.
  - mkdir -p /home/deploy/.npm-global
  - chown -R deploy:deploy /home/deploy/.npm-global
  - sudo -iu deploy npm config set prefix /home/deploy/.npm-global
  - |
    if ! sudo -iu deploy grep -q '.npm-global/bin' /home/deploy/.bashrc 2>/dev/null; then
      echo 'export PATH="$HOME/.npm-global/bin:$PATH"' >> /home/deploy/.bashrc
      chown deploy:deploy /home/deploy/.bashrc
    fi
  - sudo -iu deploy bash -lc 'npm install -g @anthropic-ai/claude-code'

  # --- Codex CLI (OpenAI's coder; API-key-billed, no interactive OAuth) ---
  # Installs under deploy's user-scoped npm prefix (already set by the Claude block
  # above), so auto-updates work without sudo. Authentication is done via
  # `codex login --with-api-key` after first secret-refresh — see Task 5's
  # refresh-secrets.sh which calls login after rewriting /opt/agenticos/.env.
  # For the FIRST boot of a fresh Droplet (before the secret-refresh timer
  # has fired), this block also does an initial login from OPENAI_API_KEY
  # in /opt/agenticos/.env if that env var is set.
  - sudo -iu deploy bash -lc 'npm install -g @openai/codex'
  - |
    if [ -f /opt/agenticos/.env ] && grep -q '^OPENAI_API_KEY=' /opt/agenticos/.env; then
      sudo -iu deploy bash -lc 'set -a && source /opt/agenticos/.env && set +a && printenv OPENAI_API_KEY | codex login --with-api-key'
    else
      echo "INFO: skipping initial codex login — OPENAI_API_KEY not yet in .env" >&2
    fi

  # --- Filesystem layout ---
  - mkdir -p /opt/agenticos /opt/vault /opt/backups /var/log/agenticos /etc/agenticos
  - chown -R deploy:deploy /opt/agenticos /opt/vault /opt/backups /var/log/agenticos /etc/agenticos

  # --- Clone repo ---
  - sudo -u deploy git clone https://github.com/${github_repo}.git /opt/agenticos/repo

  # --- Clone Paperclip fork (pinned to agenticos-v0.1.0) ---
  # Canonical fork repo name is Paperclip-AgenticOS (GitHub redirects the bare
  # `paperclip` name, but pin the real one). paperclip-server's compose service
  # builds its image from this clone at /opt/paperclip.
  - sudo -u deploy git clone --branch agenticos-v0.1.0 --depth 1 https://github.com/EngineeringMoonBear/Paperclip-AgenticOS.git /opt/paperclip

  # --- AgenticOS docker-compose (telemetry DB + Ollama + OpenViking + Hermes).
  #
  # The openviking-config directory in the repo holds ov.conf, which the
  # OpenViking container bind-mounts read-only at /app/.openviking/ov.conf.
  # We copy it to /opt/agenticos/openviking-config/ so the path is stable
  # even if the repo gets re-cloned. /opt/vault is created earlier in this
  # runcmd block (mkdir /opt/vault), and that ordering matters: the compose
  # `up -d` below tries to bind-mount /opt/vault into openviking, so it
  # must exist and be owned by deploy first.
  - |
    if [ -f /opt/agenticos/repo/docker-compose.yml ]; then
      cp /opt/agenticos/repo/docker-compose.yml /opt/agenticos/docker-compose.yml
      if [ -d /opt/agenticos/repo/openviking-config ]; then
        mkdir -p /opt/agenticos/openviking-config
        cp -a /opt/agenticos/repo/openviking-config/. /opt/agenticos/openviking-config/
        chown -R deploy:deploy /opt/agenticos/openviking-config
      fi
      # Hermes config — bind-mounted read-only at /opt/data/config.yaml inside
      # the hermes-agent container. Copying to a stable /opt/agenticos/ path
      # decouples the bind-mount source from the repo clone location.
      if [ -d /opt/agenticos/repo/hermes-config ]; then
        mkdir -p /opt/agenticos/hermes-config
        cp -a /opt/agenticos/repo/hermes-config/. /opt/agenticos/hermes-config/
        chown -R deploy:deploy /opt/agenticos/hermes-config
      fi
      # Symlink packages/ so the docker-compose build contexts for hermes-agent
      # and inbox-watcher (./packages/agenticos-hermes/) resolve relative to
      # /opt/agenticos/ without copying the entire workspace.
      #
      # CRITICAL: `ln -sfn SRC DEST` does NOT replace an existing *directory* at
      # DEST — the -f flag only clobbers a file or an existing symlink, never a
      # real dir. If a stale real /opt/agenticos/packages already exists (left by
      # an earlier provision, a manual copy, or a failed prior link), `ln -sfn`
      # silently creates packages/packages INSIDE it and leaves the stale tree in
      # place — so every hermes/inbox-watcher build then COPYs a frozen snapshot
      # and ships stale code while `git pull` only updates repo/packages. Guard
      # against that: remove any non-symlink at DEST first, then (re)link.
      if [ -e /opt/agenticos/packages ] && [ ! -L /opt/agenticos/packages ]; then
        rm -rf /opt/agenticos/packages
      fi
      ln -sfn /opt/agenticos/repo/packages /opt/agenticos/packages
      # Ensure /opt/agenticos/.env exists with correct ownership/perms before
      # we UPSERT secrets into it. Touch-only (no content) so the UPSERT
      # blocks below own every line we care about.
      if [ ! -f /opt/agenticos/.env ]; then
        touch /opt/agenticos/.env
        chmod 600 /opt/agenticos/.env
        chown deploy:deploy /opt/agenticos/.env
      fi
      # BETTER_AUTH_SECRET — required by paperclip-server in authenticated mode
      # (compose reads it from .env as $${BETTER_AUTH_SECRET}). Self-generated on
      # the Droplet (not a shared secret — it only signs local sessions). Set
      # ONLY when absent so a re-provision preserves the existing value and
      # doesn't invalidate live sessions.
      if ! grep -q '^BETTER_AUTH_SECRET=' /opt/agenticos/.env; then
        echo "BETTER_AUTH_SECRET=$(openssl rand -base64 48)" >> /opt/agenticos/.env
      fi
      # AgenticOS Postgres password — single source of truth is 1Password,
      # passed in by Terraform as the agenticos_db_password template var
      # (rendered below as a literal). Same UPSERT pattern as the OpenViking
      # key: set on a fresh Droplet, and CORRECT it on any re-provision so
      # the Droplet's .env never drifts from the value App Platform's
      # dashboard uses to construct AGENTICOS_DB_URL.
      #
      # IMPORTANT CAVEAT: the agenticos-db container only consults
      # POSTGRES_PASSWORD on FIRST init of its data volume. Rewriting the
      # value here on an existing Droplet updates the .env (so newly-started
      # containers read the new value) but does NOT change the password of
      # the existing `agenticos` Postgres role. A real rotation requires
      # either an `ALTER USER agenticos WITH PASSWORD '...'` against the
      # running DB, or a volume reset. See docs/runbooks/backup-and-recovery.md.
      if grep -q '^AGENTICOS_DB_PASSWORD=' /opt/agenticos/.env; then
        sed -i "s|^AGENTICOS_DB_PASSWORD=.*|AGENTICOS_DB_PASSWORD=${agenticos_db_password}|" /opt/agenticos/.env
      else
        echo "AGENTICOS_DB_PASSWORD=${agenticos_db_password}" >> /opt/agenticos/.env
      fi
      # Refuse to proceed if the value rendered empty (missing TF_VAR) — same
      # fail-loud posture as the OpenViking guard below.
      DB_PW=$(grep '^AGENTICOS_DB_PASSWORD=' /opt/agenticos/.env | cut -d= -f2-)
      if [ -z "$${DB_PW}" ]; then
        echo "FATAL: AGENTICOS_DB_PASSWORD missing in /opt/agenticos/.env; refusing to start (set TF_VAR_agenticos_db_password)" >&2
        exit 1
      fi
      # OpenViking root API key — single source of truth is 1Password, passed
      # in by Terraform as the openviking_root_api_key template var (rendered
      # below as a literal). We UPSERT it: set on a fresh Droplet, and CORRECT
      # it on any re-provision so the Droplet never drifts from the value
      # App Platform's dashboard uses. The guard further down refuses to start
      # OpenViking if this ends up empty or the placeholder, so a missing
      # TF_VAR fails the deploy loudly instead of shipping a weak key.
      if grep -q '^OPENVIKING_ROOT_API_KEY=' /opt/agenticos/.env; then
        sed -i "s|^OPENVIKING_ROOT_API_KEY=.*|OPENVIKING_ROOT_API_KEY=${openviking_root_api_key}|" /opt/agenticos/.env
      else
        echo "OPENVIKING_ROOT_API_KEY=${openviking_root_api_key}" >> /opt/agenticos/.env
      fi
      # Template the root_api_key into ov.conf. The repo ships a placeholder
      # (__OPENVIKING_ROOT_API_KEY__) and we substitute from .env so the
      # actual secret never lives in git. This runs AFTER the `cp -a` above,
      # which re-copies the repo's placeholder ov.conf over /opt on every
      # (re-)deploy — so we must re-substitute, and VERIFY, each time. If the
      # substitution is ever skipped or fails, the server would authenticate
      # with the well-known literal placeholder (a security hole) or, on an
      # empty key, every client breaks silently. We refuse to proceed in
      # either case: a failed provision is strictly better than a
      # placeholder-key server.
      #
      # Double-dollar on the shell-variable references escapes Terraform
      # templatefile() interpolation so the bash reference survives into the
      # rendered cloud-init for the shell to expand at boot. NOTE: do not
      # write the dollar-brace OV_KEY token in these comments either —
      # templatefile() scans the raw file bytes, comments included, and a
      # bare reference makes terraform plan fail with "vars map does not
      # contain key OV_KEY".
      if [ ! -f /opt/agenticos/openviking-config/ov.conf ]; then
        echo "FATAL: /opt/agenticos/openviking-config/ov.conf missing; cannot template OpenViking key" >&2
        exit 1
      fi
      OV_KEY=$(grep '^OPENVIKING_ROOT_API_KEY=' /opt/agenticos/.env | cut -d= -f2-)
      if [ -z "$${OV_KEY}" ] || [ "$${OV_KEY}" = "__OPENVIKING_ROOT_API_KEY__" ]; then
        echo "FATAL: OPENVIKING_ROOT_API_KEY missing or still the placeholder in /opt/agenticos/.env; refusing to start OpenViking" >&2
        exit 1
      fi
      sed -i "s|__OPENVIKING_ROOT_API_KEY__|$${OV_KEY}|g" /opt/agenticos/openviking-config/ov.conf
      # Post-condition: the placeholder MUST be gone now. If it survived (sed
      # no-match, CRLF, an edited delimiter, a stale copy racing the cp above),
      # we would otherwise boot a placeholder-key server. Abort instead.
      if grep -q '__OPENVIKING_ROOT_API_KEY__' /opt/agenticos/openviking-config/ov.conf; then
        echo "FATAL: ov.conf still contains the root_api_key placeholder after substitution; aborting before container start" >&2
        exit 1
      fi
      # Build the Paperclip plugin dists (vault / openviking / github) BEFORE
      # compose up. paperclip-server bind-mounts packages/<p>/dist into
      # /paperclip/plugins/<p>/dist, so the dist must exist or the plugins can't
      # load. Node + pnpm were installed earlier in this runcmd block; build as
      # deploy via a login shell so they're on PATH. (Updates post-provision are
      # handled by the deploy-droplet-plugins.yml GH Actions workflow.)
      sudo -iu deploy bash -lc 'cd /opt/agenticos/repo && pnpm install --frozen-lockfile --filter @agenticos/vault-plugin --filter @agenticos/openviking-plugin --filter @agenticos/github-plugin && pnpm --filter @agenticos/vault-plugin --filter @agenticos/openviking-plugin --filter @agenticos/github-plugin build'

      # Ensure the dedicated `paperclip` database exists before paperclip-server
      # starts (its DATABASE_URL targets .../paperclip, but agenticos-db only
      # auto-creates POSTGRES_DB=agenticos on first volume init). Bring up
      # Postgres first, wait for it, then CREATE DATABASE if absent (idempotent).
      cd /opt/agenticos && sudo -u deploy docker compose -f /opt/agenticos/docker-compose.yml --env-file /opt/agenticos/.env up -d agenticos-db
      for i in $(seq 1 30); do
        if sudo -u deploy docker exec agenticos-db pg_isready -U agenticos -d agenticos >/dev/null 2>&1; then break; fi
        sleep 2
      done
      if ! sudo -u deploy docker exec agenticos-db psql -U agenticos -d agenticos -tAc "SELECT 1 FROM pg_database WHERE datname='paperclip'" | grep -q 1; then
        sudo -u deploy docker exec agenticos-db psql -U agenticos -d agenticos -c "CREATE DATABASE paperclip"
        echo "created paperclip database"
      fi

      # --build so the locally-tagged overlay image (agenticos/hermes-agent:local)
      # is built from infra/docker/hermes-agent/Dockerfile on every fresh
      # deploy. Idempotent: if the image already exists at the same content
      # hash, Docker reuses it.
      cd /opt/agenticos && sudo -u deploy docker compose -f /opt/agenticos/docker-compose.yml --env-file /opt/agenticos/.env up -d --build
    else
      echo "WARN: docker-compose.yml missing from repo; skipping db bring-up" >&2
    fi

  # --- Run dashboard migrations against agenticos-db ---
  # Applies apps/dashboard/migrations/*.sql via node-pg-migrate. Idempotent —
  # node-pg-migrate tracks applied migrations in the pgmigrations table and
  # skips ones already at the target version. Runs after the compose up -d so
  # agenticos-db is alive; the script also waits up to 60s for pg_isready.
  - chmod +x /opt/agenticos/repo/infra/cloud-init/scripts/run-migrations.sh
  - /opt/agenticos/repo/infra/cloud-init/scripts/run-migrations.sh

  # --- Register AgenticOS cron jobs in Hermes ---
  # Writes daily-brief + cost-report entries into the shared cron jobs.json
  # via `hermes cron create`. Runs INSIDE the hermes-agent container (which
  # is already healthy by the time compose-up returns). Idempotent — the
  # script checks `cron list` for each job name before creating.
  - |
    if docker inspect hermes-agent >/dev/null 2>&1; then
      docker cp /opt/agenticos/repo/infra/scripts/register-cron-jobs.sh hermes-agent:/tmp/register-cron-jobs.sh
      docker exec hermes-agent /tmp/register-cron-jobs.sh || \
        echo "WARN: cron-job registration failed; rerun manually with docker exec hermes-agent /tmp/register-cron-jobs.sh" >&2
    fi

  # --- Ollama model pre-pull ---
  # Pre-pulls Qwen 2.5 3B (general SLM) and nomic-embed-text (embeddings for
  # OpenViking). Done after `docker compose up -d` so the container is alive.
  # Idempotent: ollama pull is a no-op if the model is already present.
  # Runs in background (`&`) so cloud-init doesn't block on the ~2.3 GB
  # download — first agent task after boot may wait if it triggers before
  # the pull completes, but that's a one-time first-deploy cost.
  - |
    if docker ps --format '{{.Names}}' | grep -q '^ollama$'; then
      for i in $(seq 1 30); do
        if docker exec ollama ollama --version > /dev/null 2>&1; then break; fi
        sleep 2
      done
      (docker exec ollama ollama pull qwen2.5:3b && \
       docker exec ollama ollama pull nomic-embed-text) &
    fi

  # --- Honcho reachability ---
  # Honcho's container binds 0.0.0.0:8000, but UFW (default deny incoming on
  # the public interface) keeps it off the open internet. We explicitly allow
  # port 8000 on:
  #   - eth1: the DigitalOcean VPC-private interface, so App Platform's
  #     dashboard service can reach HONCHO_URL=http://<vpc-private-ip>:8000
  #   - tailscale0: so the Mac (and any future Tailnet member) can hit Honcho
  #     directly over Tailscale for debugging / direct API calls.
  # Public IP traffic to :8000 remains blocked by the default-deny policy.
  - ufw allow in on eth1 to any port 8000 proto tcp
  - ufw allow in on tailscale0 to any port 8000 proto tcp

  # --- Curator timer (won't actually fire usefully until `claude /login` is done) ---
  - systemctl daemon-reload
  - systemctl enable --now agenticos-curator.timer

  # --- Postgres backup timer (daily pg_dump → /opt/backups, 14-day retention) ---
  - systemctl enable --now agenticos-pg-backup.timer

  # --- OpenViking memory backup timer (daily pack/backup → /opt/backups) ---
  - systemctl enable --now agenticos-viking-backup.timer

  # --- Unattended security upgrades ---
  - echo 'APT::Periodic::Unattended-Upgrade "1";' > /etc/apt/apt.conf.d/20auto-upgrades
  - echo 'APT::Periodic::Update-Package-Lists "1";' >> /etc/apt/apt.conf.d/20auto-upgrades

final_message: |
  AgenticOS Droplet bootstrap complete.
  Manual steps remaining:
   1. SSH in and run `claude /login` to authenticate with Claude Max.
      Verify: `claude --print "hello"` returns a response.
   2. Configure the Paperclip plugins (token/key + register). The plugins are
      built and loaded, but their config (GitHub token, OpenViking key) is not
      set — Paperclip's plugin secret store is disabled in this version, so
      config lives in plugin config and is pushed from 1Password, never baked
      into the image. Mint a board key once:
        docker compose exec paperclip-server paperclipai token board create \
          --name secret-sync --never-expires
      store it in 1Password (AgenticOS Infra / paperclip_board_key), then from
      the Mac (tunnel open) run:
        TRIGGER_TRIAGE=1 scripts/sync-paperclip-secrets.sh
