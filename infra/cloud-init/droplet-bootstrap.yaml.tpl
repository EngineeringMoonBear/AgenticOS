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
  - systemctl enable --now syncthing@deploy.service
  - ufw allow in on tailscale0 to any port 8384 proto tcp

  # --- Node 22 + pnpm ---
  - curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  - DEBIAN_FRONTEND=noninteractive apt-get install -y nodejs
  - npm install -g pnpm@9.15.4

  # --- Claude Code (OAuth login is a manual one-time step after this) ---
  # Two-step install:
  #   1. npm install -g (as root): bootstraps the CLI so we can run `claude install`
  #   2. `claude install` (as deploy user): relocates to native user-space install
  #      at ~/.claude/local/claude.  This makes the deploy user the owner of the
  #      binary, so auto-updates work without sudo and `claude doctor` stops
  #      warning about insufficient update permissions on every invocation.
  #      Without step 2: deploy user can run claude but can't self-update.
  - npm install -g @anthropic-ai/claude-code
  - sudo -iu deploy bash -c 'claude install latest </dev/null' || true
  # Ensure ~/.claude/local is on deploy's PATH (claude install adds it but
  # cloud-init's bash session won't see the rc-file change without explicit help)
  - |
    if ! sudo -iu deploy grep -q '\.claude/local' /home/deploy/.bashrc 2>/dev/null; then
      echo 'export PATH="$HOME/.claude/local:$PATH"' >> /home/deploy/.bashrc
      chown deploy:deploy /home/deploy/.bashrc
    fi

  # --- Filesystem layout ---
  - mkdir -p /opt/agenticos /opt/vault /opt/backups /var/log/agenticos /etc/agenticos
  - chown -R deploy:deploy /opt/agenticos /opt/vault /opt/backups /var/log/agenticos /etc/agenticos

  # --- Clone repo ---
  - sudo -u deploy git clone https://github.com/${github_repo}.git /opt/agenticos/repo

  # --- Honcho docker-compose (no-op if compose file not yet in repo) ---
  - |
    if [ -f /opt/agenticos/repo/docker-compose.yml ]; then
      cp /opt/agenticos/repo/docker-compose.yml /opt/agenticos/docker-compose.yml
      if [ ! -f /opt/agenticos/.env ]; then
        echo "HONCHO_DB_PASSWORD=$(openssl rand -hex 32)" > /opt/agenticos/.env
        chmod 600 /opt/agenticos/.env
        chown deploy:deploy /opt/agenticos/.env
      fi
      cd /opt/agenticos && sudo -u deploy docker compose -f /opt/agenticos/docker-compose.yml --env-file /opt/agenticos/.env up -d
    fi

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
