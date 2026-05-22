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
  # Wait for Syncthing's first-run to create its config.xml, then change the
  # GUI bind address from the default 127.0.0.1:8384 (loopback only) to
  # 0.0.0.0:8384 so Tailscale-routed traffic can reach it. Without this,
  # opening port 8384 on tailscale0 is a no-op because Syncthing only
  # listens on lo. UFW rule below is necessary but not sufficient.
  - |
    timeout 30 bash -c '
      until [ -f /home/deploy/.local/state/syncthing/config.xml ] || \
            [ -f /home/deploy/.config/syncthing/config.xml ]; do
        sleep 1
      done
    '
  - |
    CONFIG=$(find /home/deploy/.local/state/syncthing /home/deploy/.config/syncthing -name config.xml 2>/dev/null | head -1)
    if [ -n "$CONFIG" ]; then
      sed -i 's|<address>127\.0\.0\.1:8384</address>|<address>0.0.0.0:8384</address>|' "$CONFIG"
      chown deploy:deploy "$CONFIG"
      sudo -iu deploy systemctl --user restart syncthing
    fi
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
