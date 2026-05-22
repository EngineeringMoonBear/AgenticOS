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

  # --- Filesystem layout ---
  - mkdir -p /opt/agenticos /opt/vault /opt/backups /var/log/agenticos /etc/agenticos
  - chown -R deploy:deploy /opt/agenticos /opt/vault /opt/backups /var/log/agenticos /etc/agenticos

  # --- Clone repo ---
  - sudo -u deploy git clone https://github.com/${github_repo}.git /opt/agenticos/repo

  # --- AgenticOS docker-compose (telemetry DB + Ollama + OpenViking;
  # Hermes runs as a native systemd service for now, will move to compose
  # in a later task).
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
      if [ ! -f /opt/agenticos/.env ]; then
        {
          echo "AGENTICOS_DB_PASSWORD=$(openssl rand -hex 32)"
          echo "OPENVIKING_ROOT_API_KEY=ovk_$(openssl rand -hex 24)"
        } > /opt/agenticos/.env
        chmod 600 /opt/agenticos/.env
        chown deploy:deploy /opt/agenticos/.env
      fi
      # If the .env predates OpenViking, add the key now (idempotent).
      if ! grep -q '^OPENVIKING_ROOT_API_KEY=' /opt/agenticos/.env; then
        echo "OPENVIKING_ROOT_API_KEY=ovk_$(openssl rand -hex 24)" >> /opt/agenticos/.env
      fi
      # Template the root_api_key into ov.conf. The repo ships a placeholder
      # (__OPENVIKING_ROOT_API_KEY__) and we substitute from .env so the
      # actual secret never lives in git.
      if [ -f /opt/agenticos/openviking-config/ov.conf ]; then
        OV_KEY=$(grep '^OPENVIKING_ROOT_API_KEY=' /opt/agenticos/.env | cut -d= -f2-)
        sed -i "s|__OPENVIKING_ROOT_API_KEY__|${OV_KEY}|g" /opt/agenticos/openviking-config/ov.conf
      fi
      cd /opt/agenticos && sudo -u deploy docker compose -f /opt/agenticos/docker-compose.yml --env-file /opt/agenticos/.env up -d
    else
      echo "WARN: docker-compose.yml missing from repo; skipping db bring-up" >&2
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

  # --- Unattended security upgrades ---
  - echo 'APT::Periodic::Unattended-Upgrade "1";' > /etc/apt/apt.conf.d/20auto-upgrades
  - echo 'APT::Periodic::Update-Package-Lists "1";' >> /etc/apt/apt.conf.d/20auto-upgrades

final_message: |
  AgenticOS Droplet bootstrap complete.
  ONE manual step remains: SSH in and run `claude /login` to authenticate with Claude Max.
  Then verify: `claude --print "hello"` should return a response.
