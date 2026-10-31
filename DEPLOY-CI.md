# Automatic deployment for Riverbreaker

Two GitHub Actions workflows live in `.github/workflows/`:

| Workflow | Trigger | What it does | Secrets |
| --- | --- | --- | --- |
| `ci.yml` | every pull request, every non-master branch | static checks, headless smoke test, build, artifact | none |
| `deploy.yml` | **manual run only** (Actions → Deploy → Run workflow) | same checks, then build → approval → rsync over SSH → live check | `DEPLOY_SSH_KEY` |

Nothing is compiled and there are no npm dependencies: the site is plain static
files. The "build" step (`tools/build.mjs`) copies an explicit allowlist of files
into `dist/` and stamps `sw.js` with the commit id, so every deploy invalidates
the offline cache of every installed copy of the game.

---

## 1. One-time setup on the server

> **Oracle Cloud (Ubuntu)?** The instance-specific steps — rsync/rrsync, the deploy
> user, OCI Security Lists and the host firewall, and the port-22 caveat for
> GitHub-hosted runners — are spelled out in
> [DEPLOY-ORACLE-UBUNTU.md](DEPLOY-ORACLE-UBUNTU.md). Follow that file, then come
> back here for the GitHub part.

Run these on the machine that serves `senssoft.com`. Replace `deploy` with the
account you want to use and keep the path exactly as configured.

### 1.1 A dedicated, unprivileged account and directory

```bash
sudo adduser --disabled-password --gecos "" deploy
sudo mkdir -p /var/www/html/river
sudo chown -R deploy:www-data /var/www/html/river
sudo chmod -R 755 /var/www/html/river
```

The account needs no sudo, no shell login and no access to anything else. Put the
site in its **own** directory: the deploy uses `rsync --delete`, so every file in
that directory that is not part of the build is removed.

### 1.2 Restricted SSH key

Create the key on your own machine (never on the server, never in the repo):

```bash
ssh-keygen -t ed25519 -a 100 -C "github-actions river deploy" -f river_deploy -N ""
```

You get `river_deploy` (private, goes to GitHub) and `river_deploy.pub` (public,
goes to the server). Install the **public** key with a forced command:

```bash
# on the server, as the deploy user
install -d -m 700 ~deploy/.ssh
command -v rrsync            # usually /usr/bin/rrsync (rsync >= 3.2.4)
echo 'restrict,command="/usr/bin/rrsync -wo /var/www/html/river" ssh-ed25519 AAAAC3Nz... github-actions river deploy' \
  >> ~deploy/.ssh/authorized_keys
chmod 600 ~deploy/.ssh/authorized_keys
```

Why this line matters:

* `restrict` disables PTY, port forwarding, agent forwarding and X11 forwarding.
* `command="rrsync -wo <dir>"` replaces the shell: the key can only run `rsync`
  in **write-only** mode and only inside `/var/www/html/river`. It cannot read
  files, cannot run anything else, cannot leave that directory.
* Even if the private key leaks, the attacker gets write access to one static
  folder — no shell, no other site, no `~/.ssh`, no system access.

Check it from your machine:

```bash
ssh -i river_deploy -o IdentitiesOnly=yes deploy@senssoft.com 'ls'   # must fail
```

### 1.3 Verify the server with a script

`tools/server-check.sh` is a read-only checker for everything above (user, key
restrictions, directory rights, sshd settings, firewall, web server):

```bash
scp tools/server-check.sh ubuntu@senssoft.com:
ssh ubuntu@senssoft.com 'sudo ./server-check.sh /var/www/html/river'
```

It prints `ok` / `warn` / `FAIL` lines and exits non-zero while anything is
unresolved.

### 1.4 Record the host key

The workflow pins the server's host key, so a man-in-the-middle cannot pretend to
be the server. Save the line you will paste into GitHub:

```bash
ssh-keyscan -t ed25519 senssoft.com > river_known_hosts
cat river_known_hosts
```

Compare the fingerprint with what the server prints:

```bash
ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub
```

---

## 2. One-time setup on GitHub

### 2.1 Repository variables (Settings → Secrets and variables → Actions → Variables)

These are not secrets; they are visible to anyone who can read the repo, which is
what you want for host, path and host key.

| Variable | Example | Notes |
| --- | --- | --- |
| `DEPLOY_HOST` | `senssoft.com` | hostname only |
| `DEPLOY_USER` | `deploy` | the restricted account |
| `DEPLOY_PATH` | `/var/www/html/river/` | must be absolute and end with `/river/` |
| `DEPLOY_URL` | `https://senssoft.com/river/` | used for the post-deploy check |
| `DEPLOY_KNOWN_HOSTS` | `senssoft.com ssh-ed25519 AAAA...` | the whole line from step 1.3 |

### 2.2 Secret

| Secret | Value |
| --- | --- |
| `DEPLOY_SSH_KEY` | the **private** key file `river_deploy`, pasted verbatim (including the `BEGIN`/`END` lines) |

Only the `deploy` job of `deploy.yml` reads it, and that workflow has no
`pull_request` trigger, so pull request code never runs with the key in scope.

### 2.3 Environment protection (Settings → Environments → New environment → `production`)

* **Required reviewers**: add yourself. Every production deploy then waits for an
  explicit approval click, even if someone gains write access to the repo.
* **Deployment branches**: `Selected branches` → `master` only.
* Optional: **Wait timer** and **Prevent self-review** if there are several people.

### 2.4 Branch protection (Settings → Branches → `master`)

* Require a pull request before merging.
* Require status checks to pass → select `Checks, smoke test and build` (from `ci.yml`).
* Block force pushes and deletions.

### 2.5 Actions defaults (Settings → Actions → General)

* Workflow permissions: **Read repository contents** (the workflows ask for
  `contents: read` explicitly, this is the belt-and-braces version).
* Fork pull request workflows: keep the default "Require approval for first-time
  contributors".

---

## 3. Everyday flow

Publishing is **manual**. `deploy.yml` has no `push` trigger, so merging a pull
request into `master` deploys nothing; the files go out by hand (section 5) or by
starting the workflow yourself.

1. Open a pull request. `ci.yml` runs the checks, the smoke test and the build;
   the workflow fails if `index.html` does not parse, if the manifest references a
   missing icon, if `sw.js` precaches a file that does not exist, or if a gameplay
   rule regresses (see below).
2. Merge when it is green.
3. To publish, either follow section 5, or — after sections 1 and 2 are done —
   start **Actions → Deploy → Run workflow** and approve the `production`
   environment.

If you later want push-to-deploy, add the trigger back to `deploy.yml`:

```yaml
on:
  push:
    branches: [master]
  workflow_dispatch:
    inputs:
      ref: ...
```

The run then verifies again, builds `dist/`, waits for the approval on the
`production` environment, and:

```bash
rsync -rlptz --checksum --delete --delay-updates dist/ deploy@senssoft.com:/var/www/html/river/
```

`--delay-updates` renames each file into place at the end of the transfer; the
site is never served a truncated file. `--delete` removes leftovers so the folder
matches the build exactly. The last step of the workflow fetches the live site and
fails unless the new commit id is visible in `https://senssoft.com/river/sw.js`.

`dist/version.json` records `{version, commit, builtAt}` for the deployed build.

---

## 4. Rollback

Actions → **Deploy** → *Run workflow* → set `ref` to the commit SHA you want to
restore (for example `3c44787`) and approve. The build is reproducible from any
commit, so the site returns to that exact state. The previous artifacts stay
available for 30 days under the *Artifacts* of each run.

---

## 5. Manual deploy (fallback)

```bash
node tools/check.mjs && node tools/smoke.mjs && node tools/build.mjs
rsync -rlptz --checksum --delete --delay-updates \
  -e "ssh -i ~/.ssh/river_deploy -o IdentitiesOnly=yes -o StrictHostKeyChecking=yes" \
  dist/ deploy@senssoft.com:/var/www/html/river/
```

Any GitHub run also produces a `river-pwa-<sha>` artifact you can unzip straight
into `/var/www/html/river/`.

---

## 6. Security model

What this setup protects against:

* **Secrets in pull requests.** `ci.yml` has no secret access; `deploy.yml` never
  runs on pull requests.
* **Stolen or leaked deploy key.** Server-side `rrsync -wo` confines it to one
  directory with no shell, no forwarding, no reads.
* **Man-in-the-middle / DNS hijack.** Pinned host key plus
  `StrictHostKeyChecking=yes`.
* **Moved action tags / supply-chain substitution.** Actions are pinned to commit
  SHAs and updated only through Dependabot PRs that CI verifies.
* **Repo/CI misconfiguration wiping the wrong directory.** The path is validated
  (`…/river/`), the hostname and user are pattern-checked, the transfer is
  dry-run first, and the target is a dedicated folder.
* **Publishing bad code by accident.** Checks + smoke test must pass, and a human
  approves the `production` environment.
* **Silent deploy failure.** The live check fails the workflow if the server is
  not serving the new version.

Residual risks — no pipeline is literally 100% safe:

* A compromised GitHub account with write access **and** environment approval
  rights can deploy whatever is on `master` (still only into the one folder).
* A malicious change merged to `master` deploys after approval; the smoke test
  only catches structural and gameplay regressions, not "intentionally bad".
  Review diffs — the game is one readable file.
* GitHub-hosted runners run your checked-out code. A malicious PR cannot reach the
  key, but a malicious commit merged to `master` can exfiltrate it through the
  deploy job — hence the forced command, which keeps the blast radius tiny.
* The server's own security (TLS, `sshd`, file permissions) is out of scope here.

Key rotation: generate a new pair, add the new public key line to
`authorized_keys`, update the secret, deploy once, then remove the old line.

---

## 7. Troubleshooting

| Symptom | Cause / fix |
| --- | --- |
| `Permission denied (publickey)` | key not in `authorized_keys`, wrong `DEPLOY_USER`, or the key file lost its `BEGIN OPENSSH PRIVATE KEY` line when pasted |
| `Host key verification failed` | `DEPLOY_KNOWN_HOSTS` does not match the server (host reinstalled / new key) |
| `rsync: command not found` | install `rsync` on the server (`sudo apt install rsync`) |
| `rrsync: command not found` | rsync older than 3.2.4; upgrade, or point `command=` at `/usr/share/rsync/scripts/rrsync` |
| Upload works, next deploy re-uploads everything | server clock/ownership; check `--omit-dir-times` and that the deploy user owns the files |
| Live check fails but files are there | caching proxy/CDN in front of the site; the workflow retries for ~60 s, then warns about `sw.js` |
| Manifest served as `text/plain` | MIME mapping missing (see README: nginx `types { application/manifest+json webmanifest; }`, Apache `.htaccess` already handles it) |
