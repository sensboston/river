# Deploy target: Ubuntu on Oracle Cloud (Always Free → Pay As You Go)

Exact, copy-paste steps to prepare an Oracle Cloud Infrastructure (OCI) Ubuntu
instance for the `deploy.yml` workflow. Everything here is done **once**; after
that every merge to `master` deploys by itself.

The general pipeline, secrets and threat model are described in
[DEPLOY-CI.md](DEPLOY-CI.md). This file covers the OCI/Ubuntu specifics.

Assumptions used below — change them if your setup differs:

| Setting | Value |
| --- | --- |
| Instance OS | Ubuntu 22.04 or 24.04 (not Oracle Linux) |
| Login user with sudo | `ubuntu` (OCI's default for Ubuntu images; `opc` is Oracle Linux) |
| New deploy user | `deploy` |
| Site directory | `/var/www/html/river` |
| Web server | nginx or Apache, already serving `senssoft.com/river/` |
| SSH port | 22 |

At the end you will have run the read-only checker:
`sudo ./server-check.sh` → all `ok`.

---

## 0. Quick checklist

| # | What | Where |
| --- | --- | --- |
| 1 | `rsync` + `rrsync` installed | server |
| 2 | user `deploy`, no sudo, no password | server |
| 3 | restricted key in `~deploy/.ssh/authorized_keys` | server |
| 4 | `/var/www/html/river` owned by `deploy:www-data` | server |
| 5 | Security List/NSG + host firewall allow 80/443 (and 22 for GitHub) | OCI console + server |
| 6 | `ssh` with the deploy key cannot run a shell | laptop |
| 7 | repo Variables + `DEPLOY_SSH_KEY` secret | GitHub |
| 8 | `production` environment with a required reviewer | GitHub |
| 9 | first deploy passes and the live `sw.js` carries the version | GitHub |
| 10 | automatic security updates, IP reserved, backups | server / OCI |

---

## 1. Check the instance

Log in to the instance as `ubuntu`:

```bash
ssh ubuntu@<PUBLIC_IP>

cat /etc/os-release | head -2          # expect Ubuntu 22.04.x / 24.04.x
id                                      # expect groups with sudo
sudo -n true && echo "passwordless sudo ok"
sudo ss -lntp | grep -E ':22 |:80 |:443 '
```

Ubuntu **22.04 or 24.04** is required for the standard `rrsync` helper. If you
are still on 20.04, finish the upgrade first (`sudo do-release-upgrade`) — a
20.04 `rsync` (3.1.3) does not ship `rrsync`.

---

## 2. Install rsync and confirm rrsync

```bash
sudo apt-get update
sudo apt-get install -y rsync perl
rsync --version | head -1
command -v rrsync; echo "rrsync exit: $?"
```

Expected on Ubuntu 22.04/24.04:

```
rsync  version 3.2.7  protocol version 31
/usr/bin/rrsync
rrsync exit: 0
```

If `rrsync` is not found but `rsync` is 3.2.4 or newer, install the upstream
single-file script (it needs `perl`, installed above):

```bash
git clone --depth 1 https://github.com/RsyncProject/rsync /tmp/rsync-src
sudo install -m 755 -o root -g root /tmp/rsync-src/support/rrsync /usr/local/bin/rrsync
rm -rf /tmp/rsync-src
```

Then use `/usr/local/bin/rrsync` instead of `/usr/bin/rrsync` in **both** the
`authorized_keys` line (step 4) and `tools/server-check.sh`. The path in those
two places must match exactly.

---

## 3. Create the deploy user

```bash
sudo adduser --disabled-password --gecos "" deploy
sudo passwd -l deploy            # no password login, ever
getent passwd deploy             # /home/deploy:/bin/bash
sudo ls -ld /home/deploy         # drwxr-xr-x  (mode 755)
```

Do **not** add `deploy` to `sudo`, `www-data` or any other group: it only needs
to write files in one directory.

The login shell stays `/bin/bash` on purpose — `sshd` runs the forced command
through the user's shell, and `/usr/sbin/nologin` would break it. The forced
command itself is what removes shell access (step 4).

---

## 4. Install the restricted deploy key

### 4.1 Create the key pair on your laptop (never on the server, never in the repo)

```bash
ssh-keygen -t ed25519 -a 100 -C "github-actions river deploy" -f ~/.ssh/river_deploy -N ""
cat ~/.ssh/river_deploy.pub
```

`~/.ssh/river_deploy` (private) goes to GitHub, `~/.ssh/river_deploy.pub`
(public) goes to the server.

### 4.2 Install it with a forced command

On the server, paste your public key into `PUB`:

```bash
PUB='ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAA... github-actions river deploy'

sudo install -d -m 700 -o deploy -g deploy /home/deploy/.ssh
echo "restrict,command=\"/usr/bin/rrsync -wo /var/www/html/river\" $PUB" \
  | sudo -u deploy tee /home/deploy/.ssh/authorized_keys
sudo chown deploy:deploy /home/deploy/.ssh/authorized_keys
sudo chmod 600 /home/deploy/.ssh/authorized_keys
sudo ls -l /home/deploy/.ssh/authorized_keys /home/deploy/.ssh
```

What the options do:

* `restrict` — no PTY, no port/agent/X11 forwarding, no `~/.ssh/rc`.
  OpenSSH 8.2+ (both supported Ubuntu versions) understands it.
* `command="rrsync -wo /var/www/html/river"` — whatever the client asks for,
  the server runs `rrsync` in **write-only** mode limited to that folder. No
  shell, no reads, no `..`, no other paths.

To rotate the key later: keep the old line, add the new one, deploy once, then
delete the old line.

### 4.3 Make sure sshd accepts it

```bash
sudo sshd -T | grep -Ei '^(passwordauthentication|pubkeyauthentication|authorizedkeysfile|allowusers|allowgroups)'
```

Expected: `pubkeyauthentication yes`, `passwordauthentication no`,
`authorizedkeysfile .ssh/authorized_keys` (or similar containing
`.ssh/authorized_keys`) and **no** `allowusers`/`allowgroups` line that excludes
`deploy`. If an `AllowUsers` line exists, add `deploy` to it in
`/etc/ssh/sshd_config.d/` and run `sudo sshd -t && sudo systemctl reload ssh`.

---

## 5. Site directory and permissions

```bash
sudo mkdir -p /var/www/html/river
sudo chown -R deploy:www-data /var/www/html/river
sudo chmod 2775 /var/www/html/river     # setgid: new files keep the www-data group
sudo chmod 755 /var/www /var/www/html   # parents must stay traversable
sudo ls -ld /var/www/html/river
```

`rsync` runs with `--chmod=D755,F644`, so uploaded directories are traversable
and files readable by the web server without any extra step.

If the game currently lives somewhere else, either move it here
(`sudo mv /path/to/river/* /var/www/html/river/ && sudo chown -R deploy:www-data /var/www/html/river`)
or use your real path everywhere — it must always end in `/river/`, because the
workflow refuses any other target.

Confirm the web server serves from the same folder:

```bash
# nginx
sudo grep -rn "root .*river" /etc/nginx/sites-enabled/ || sudo grep -rn "root" /etc/nginx/sites-enabled/ | head

# Apache
grep -rn "DocumentRoot\|Alias .*river" /etc/apache2/sites-enabled/ | head
```

After the very first deploy, check the MIME type and cache headers (nginx snippet
is in README-DEPLOY.txt):

```bash
curl -sI http://127.0.0.1/river/manifest.webmanifest | grep -i content-type
```

---

## 6. OCI networking and the host firewall

Two independent layers must both allow traffic. This matters for the deploy as
well: **the GitHub runner connects to port 22 from an arbitrary public IP.**

### 6.1 VCN Security List / NSG (OCI console)

Networking → Virtual Cloud Networks → your VCN → Security Lists → default list:

| Direction | Source | Protocol | Port | Purpose |
| --- | --- | --- | --- | --- |
| Ingress | `0.0.0.0/0` | TCP | 22 | SSH: you + GitHub Actions runners |
| Ingress | `0.0.0.0/0` | TCP | 80 | HTTP → redirect to HTTPS |
| Ingress | `0.0.0.0/0` | TCP | 443 | HTTPS |

Egress: allow all (default).

> **The most common OCI deploy failure:** if port 22 is limited to your home IP,
> `deploy.yml` cannot reach the server. Choose one:
>
> * **(a) Recommended for this setup** — open 22 to `0.0.0.0/0` and rely on
>   key-only authentication, the `restrict`+`rrsync` key (step 4) and, optionally,
>   `fail2ban` (step 10). No password exists to brute-force.
> * **(b)** Add GitHub Actions ranges from <https://api.github.com/meta>
>   (the `actions` array) as separate ingress rules — dozens of CIDRs that GitHub
>   changes over time, so this needs maintenance and can break deploys silently.
> * **(c)** Run a second `sshd` on a dedicated port for `deploy` only. More
>   moving parts; only worth it if you must keep 22 private.
>
> If you use an NSG instead of a Security List, add the same three rules to the
> NSG attached to the instance's VNIC.

### 6.2 Host firewall inside the instance

Oracle's Ubuntu images ship with `iptables` rules that end in a `REJECT`, plus
`netfilter-persistent` to restore them on boot. `ufw` may also be present.

```bash
sudo iptables -S INPUT | head -20
sudo systemctl is-active netfilter-persistent
sudo ufw status verbose            # "Status: inactive" on stock OCI images
```

If `ufw` is **active**, use it and skip the manual `iptables` rules:

```bash
sudo ufw allow OpenSSH
sudo ufw allow 80,443/tcp
sudo ufw status numbered
```

Otherwise add the rules above the final `REJECT` and persist them:

```bash
sudo iptables -I INPUT 1 -p tcp --dport 80  -j ACCEPT
sudo iptables -I INPUT 1 -p tcp --dport 443 -j ACCEPT
sudo netfilter-persistent save
sudo iptables -S INPUT | head -8
```

If `netfilter-persistent` is missing:

```bash
sudo DEBIAN_FRONTEND=noninteractive apt-get install -y iptables-persistent
sudo netfilter-persistent save
```

Do not touch port 22 here — OCI images already accept it.

Verify from your laptop (the site, not the firewall):

```bash
curl -sI https://senssoft.com/river/ | head -3
```

---

## 7. Test the key from your laptop (before touching GitHub)

```bash
# 1. The key must NOT give a shell.
ssh -i ~/.ssh/river_deploy -o IdentitiesOnly=yes -o BatchMode=yes deploy@<PUBLIC_IP> 'id'
#   → "Invalid command: ..." or "Protocol error", exit code non-zero. That is correct.

# 2. A real write into the target directory must work.
cd /path/to/river
node tools/build.mjs
rsync -rlptz --checksum --delete --delay-updates \
  -e "ssh -i ~/.ssh/river_deploy -o IdentitiesOnly=yes -o StrictHostKeyChecking=accept-new" \
  --dry-run --itemize-changes dist/ deploy@<PUBLIC_IP>:/var/www/html/river/
#   → a list of files that would be sent, no permission errors.
```

`StrictHostKeyChecking=accept-new` is fine for this one manual check; the
workflow itself pins the host key.

Now record the host key for GitHub. Use **exactly** the hostname you will put
into `DEPLOY_HOST`:

```bash
ssh-keyscan -t ed25519 senssoft.com 2>/dev/null | grep -v '^#' > /tmp/river_known_hosts
cat /tmp/river_known_hosts
# sanity check against what the server reports:
ssh ubuntu@<PUBLIC_IP> 'ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub'
```

---

## 8. GitHub configuration

Settings → Secrets and variables → Actions.

**Variables** (visible, not secret):

| Name | Value for this setup |
| --- | --- |
| `DEPLOY_HOST` | `senssoft.com` |
| `DEPLOY_USER` | `deploy` |
| `DEPLOY_PATH` | `/var/www/html/river/` |
| `DEPLOY_URL` | `https://senssoft.com/river/` |
| `DEPLOY_KNOWN_HOSTS` | the single line printed above |

**Secret**:

| Name | Value |
| --- | --- |
| `DEPLOY_SSH_KEY` | the complete contents of `~/.ssh/river_deploy`, `-----BEGIN OPENSSH PRIVATE KEY-----` through `-----END OPENSSH PRIVATE KEY-----` |

The workflow validates the secret format, checks that `DEPLOY_KNOWN_HOSTS`
contains an entry for `DEPLOY_HOST`, rejects any `DEPLOY_PATH` that does not end
in `/river/`, and prints the SSH key fingerprint (never the key).

**Environment** (Settings → Environments → New environment → `production`):

* Required reviewers: add yourself → every deploy waits for one click.
* Deployment branches: *Selected branches* → `master`.
* Optional: wait timer 0–5 min, prevent self-review if there are several admins.

**Branch protection** (Settings → Branches → `master`): require a pull request,
require the `Checks, smoke test and build` status check, block force pushes.

If `senssoft.com` resolves to a CDN/proxy in front of the instance, deploy still
works (rsync goes straight to the origin), but the live check in the workflow may
read a cached `sw.js` for a while — the step retries for about a minute.

---

## 9. First deploy

1. Actions → **Deploy** → *Run workflow* on `master`.
2. Approve the `production` environment when GitHub asks.
3. Watch the run: `Validate deploy target` → dry run → upload → `Verify the live site`.

Then confirm by hand:

```bash
curl -s https://senssoft.com/river/sw.js | grep "const VERSION"
curl -s https://senssoft.com/river/version.json
curl -sI https://senssoft.com/river/manifest.webmanifest | grep -i content-type
```

The cache version looks like `riverbreaker-<commit>`, so every installed copy of
the game updates on its next launch.

Server-side audit trail:

```bash
sudo grep -i 'deploy' /var/log/auth.log | tail -20      # Ubuntu 22.04
sudo journalctl -u ssh --since "1 hour ago" | tail -20  # Ubuntu 24.04 / journald
```

---

## 10. Hardening and OCI housekeeping (recommended)

```bash
# Security updates without manual work
sudo apt-get install -y unattended-upgrades
sudo dpkg-reconfigure -f noninteractive unattended-upgrades
sudo systemctl enable --now unattended-upgrades

# Keep SSH logs quiet if 22 is open to the world (key auth stays in charge)
sudo apt-get install -y fail2ban
sudo systemctl enable --now fail2ban
```

OCI side:

* **Reserve the public IP** (Networking → IP management → Reserved public IPs →
  assign to the instance) so the DNS record never has to change. Ephemeral IPs
  can change if the instance is stopped/restarted or recreated.
* **Block volume backups**: Compute → instance → Boot volumes → assign a backup
  policy (Bronze is enough for a static site). Note that backup storage is
  billable even in Pay As You Go; Always Free includes a small amount.
* **Budget alert**: Billing → Budgets → a $1 budget with a 100 % alert so a
  misconfiguration cannot surprise you.
* Keep the instance patched: `sudo apt-get update && sudo apt-get upgrade` or rely
  on unattended-upgrades.

---

## 11. Troubleshooting (OCI / Ubuntu)

| Symptom | Cause | Fix |
| --- | --- | --- |
| Workflow fails at upload with `Connection timed out` | Security List/NSG blocks 22 from GitHub runner IPs, or host `iptables`/`ufw` rejects | step 6; GitHub requires 22 reachable from `0.0.0.0/0` or from its published ranges |
| `Permission denied (publickey)` | key not in `authorized_keys`, wrong `DEPLOY_USER`, `AllowUsers` excludes `deploy`, or `/home/deploy` is group-writable | step 4.2/4.3; `sudo chmod 755 /home/deploy` |
| `Invalid command: ...` in the workflow log | `authorized_keys` points at a missing `rrsync` | `command -v rrsync` and fix the path (step 2) |
| `rsync: command not found` | rsync missing on the server | `sudo apt-get install -y rsync` |
| `rsync error: some files/attrs were not transferred` (code 23) | `deploy` cannot write to the folder | `sudo chown -R deploy:www-data /var/www/html/river` |
| Upload succeeds, site still serves the old build | service worker cache / CDN in front | check `curl -s .../sw.js \| grep VERSION`; reopen the PWA or clear site data |
| Site returns 403/404 after deploy | nginx/Apache `root` points elsewhere, or `.htaccess` ignored (Apache `AllowOverride`) | see README-DEPLOY.txt |
| `Host key verification failed` | `DEPLOY_KNOWN_HOSTS` does not match the current host key | re-run `ssh-keyscan`, compare with `ssh-keygen -lf` on the server |
| `manifest.webmanifest` served as `text/plain` | MIME mapping missing | nginx `types { application/manifest+json webmanifest; }`, Apache reads `.htaccess` |
| Instance unreachable after `ufw enable` | SSH not allowed in ufw | `sudo ufw allow OpenSSH` (via the OCI serial console if needed) |

---

## 12. Key rotation

```bash
# laptop
ssh-keygen -t ed25519 -a 100 -C "github-actions river deploy 2" -f ~/.ssh/river_deploy2 -N ""
cat ~/.ssh/river_deploy2.pub

# server: add a second line, leave the old one for now
PUB='ssh-ed25519 AAAA... comment-2'
echo "restrict,command=\"/usr/bin/rrsync -wo /var/www/html/river\" $PUB" \
  | sudo -u deploy tee -a /home/deploy/.ssh/authorized_keys

# GitHub: replace DEPLOY_SSH_KEY with the new private key and run Deploy once

# server: remove the old line, keep only the new key
sudo -u deploy nano /home/deploy/.ssh/authorized_keys
```

Nothing else changes: host, path, user and host key stay the same.
