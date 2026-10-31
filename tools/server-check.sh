#!/usr/bin/env bash
# Read-only readiness check for the Riverbreaker SSH deploy target (Ubuntu).
#
#   sudo ./server-check.sh [/var/www/html/river]
#
# Checks the deploy user, its restricted key, the target directory, sshd settings
# and the firewall. It changes nothing. Exit code 0 means everything is ready.

set -uo pipefail

SITE_DIR="${1:-/var/www/html/river}"
DEPLOY_USER="${DEPLOY_USER:-deploy}"
HOME_DIR="$(getent passwd "$DEPLOY_USER" 2>/dev/null | cut -d: -f6)"
AK="$HOME_DIR/.ssh/authorized_keys"

pass=0; fail=0; warnings=0
if [ -t 1 ]; then G=$'\033[32m'; R=$'\033[31m'; Y=$'\033[33m'; N=$'\033[0m'; else G=; R=; Y=; N=; fi
ok()   { printf '  %sok%s   %s\n' "$G" "$N" "$*"; pass=$((pass + 1)); }
bad()  { printf '  %sFAIL%s %s\n' "$R" "$N" "$*"; fail=$((fail + 1)); }
warn() { printf '  %swarn%s %s\n' "$Y" "$N" "$*"; warnings=$((warnings + 1)); }
section() { printf '\n%s\n' "$*"; }

# Read a file as root when needed (OCI's default user has passwordless sudo).
read_file() {
  if [ -r "$1" ]; then cat "$1" && return 0; fi
  if [ "$(id -u)" -eq 0 ]; then cat "$1" && return 0; fi
  sudo -n cat "$1" 2>/dev/null && return 0
  return 1
}
as_root() {
  if [ "$(id -u)" -eq 0 ]; then "$@"; else sudo -n "$@"; fi
}
# Run a command as another user without needing an interactive password.
as_user() {
  local user="$1"; shift
  if [ "$(id -u)" -eq 0 ]; then
    su -s /bin/sh -c "$(printf '%q ' "$@")" "$user" >/dev/null 2>&1
  else
    sudo -n -u "$user" -- "$@" >/dev/null 2>&1
  fi
}

printf 'Riverbreaker deploy target check — site: %s — user: %s\n' "$SITE_DIR" "$DEPLOY_USER"

# --- OS ---------------------------------------------------------------------
section 'Operating system'
if [ -r /etc/os-release ]; then
  . /etc/os-release
  echo "  ${PRETTY_NAME:-unknown}"
  if [ "${ID:-}" = "ubuntu" ]; then
    case "${VERSION_ID:-}" in
      22.04|24.04|24.10|25.04) ok "Ubuntu ${VERSION_ID} ships a recent rsync with rrsync" ;;
      *) warn "Ubuntu ${VERSION_ID:-?}: rrsync needs rsync >= 3.2.4 (see DEPLOY-ORACLE-UBUNTU.md step 2)" ;;
    esac
  else
    warn "distribution ${ID:-unknown} ${VERSION_ID:-}: this guide targets Ubuntu 22.04/24.04"
  fi
else
  warn 'no /etc/os-release, cannot identify the distribution'
fi

# --- rsync / rrsync ---------------------------------------------------------
section 'rsync and rrsync'
if command -v rsync >/dev/null 2>&1; then
  ok "rsync: $(rsync --version | head -1 | tr -s ' ')"
else
  bad 'rsync is not installed (sudo apt-get install -y rsync)'
fi
RRSYNC_FOUND="$(command -v rrsync || true)"
if [ -n "$RRSYNC_FOUND" ]; then
  ok "rrsync: $RRSYNC_FOUND"
else
  bad 'rrsync not found in PATH (see DEPLOY-ORACLE-UBUNTU.md step 2)'
fi

# --- deploy user ------------------------------------------------------------
section "Deploy user '$DEPLOY_USER'"
if [ -z "$HOME_DIR" ]; then
  bad "user $DEPLOY_USER does not exist (sudo adduser --disabled-password --gecos \"\" $DEPLOY_USER)"
else
  ok "user exists, home $HOME_DIR, shell $(getent passwd "$DEPLOY_USER" | cut -d: -f7)"
  if id -nG "$DEPLOY_USER" 2>/dev/null | tr ' ' '\n' | grep -qx sudo; then
    bad "$DEPLOY_USER is in the sudo group; the deploy user must not have root rights"
  else
    ok "no sudo group membership"
  fi
  home_mode="$(stat -c '%a' "$HOME_DIR" 2>/dev/null || true)"
  if [ -z "$home_mode" ]; then
    warn "cannot read the mode of $HOME_DIR"
  elif [ $((8#$home_mode & 8#022)) -ne 0 ]; then
    bad "home directory mode $home_mode is group/other writable (chmod 755 $HOME_DIR)"
  else
    ok "home directory mode $home_mode is not group/other writable"
  fi
fi

# --- restricted key ---------------------------------------------------------
section 'Restricted deploy key'
if [ -z "$HOME_DIR" ]; then
  bad 'cannot locate authorized_keys (missing user)'
elif ! AK_TEXT="$(read_file "$AK")"; then
  bad "cannot read $AK (run this script with sudo)"
else
  ok "authorized_keys found"
  AK_MODE="$(stat -c '%a' "$AK" 2>/dev/null || true)"
  AK_OWNER="$(stat -c '%U' "$AK" 2>/dev/null || true)"
  [ "$AK_MODE" = "600" ] && ok 'authorized_keys mode 600' || bad "authorized_keys mode is ${AK_MODE:-?} (chmod 600 $AK)"
  [ "$AK_OWNER" = "$DEPLOY_USER" ] && ok "authorized_keys owned by $DEPLOY_USER" || bad "authorized_keys owned by ${AK_OWNER:-?} (chown $DEPLOY_USER:$DEPLOY_USER $AK)"
  SSH_DIR_MODE="$(stat -c '%a' "$HOME_DIR/.ssh" 2>/dev/null || true)"
  [ "$SSH_DIR_MODE" = "700" ] && ok '.ssh mode 700' || bad ".ssh mode is ${SSH_DIR_MODE:-?} (chmod 700 $HOME_DIR/.ssh)"

  FORCED="$(printf '%s\n' "$AK_TEXT" | sed -n 's/.*command="\([^"]*\)".*/\1/p' | head -1)"
  FORCED_BIN="${FORCED%% *}"
  if [ -z "$FORCED" ]; then
    bad 'no command="..." restriction in authorized_keys; the key would give a shell'
  else
    ok "forced command: $FORCED"
    case "$FORCED" in
      *" -wo "*|*" -wo"*|*"-ro "*) ;;
      *) warn 'forced command is neither -wo (write only) nor -ro; check the flags' ;;
    esac
    case "$FORCED" in
      *"/river"*) ok "forced command is limited to a path ending in /river" ;;
      *) warn 'the forced command path does not end in /river; DEPLOY_PATH must match it exactly' ;;
    esac
    if [ -x "$FORCED_BIN" ]; then
      ok "forced command binary exists: $FORCED_BIN"
    else
      bad "forced command binary is missing or not executable: $FORCED_BIN"
    fi
  fi
  if printf '%s\n' "$AK_TEXT" | grep -q 'restrict'; then
    ok 'restrict option present (no PTY, no forwarding)'
  else
    warn 'no "restrict" option; add restrict,command="..." to the key line'
  fi
  if printf '%s\n' "$AK_TEXT" | grep -qE 'ssh-(ed25519|rsa)|ecdsa-sha2'; then
    ok 'at least one public key installed'
  else
    bad 'no public key found in authorized_keys'
  fi
fi

# --- target directory -------------------------------------------------------
section "Target directory $SITE_DIR"
if [ -d "$SITE_DIR" ]; then
  ok "directory exists ($(stat -c 'mode %a, owner %U:%G' "$SITE_DIR" 2>/dev/null || echo 'mode unknown'))"
  if [ -n "$HOME_DIR" ]; then
    if as_user "$DEPLOY_USER" test -w "$SITE_DIR"; then
      ok "$DEPLOY_USER can write to it"
    else
      bad "$DEPLOY_USER cannot write to it (chown -R $DEPLOY_USER:www-data $SITE_DIR)"
    fi
  fi
  if [ -f "$SITE_DIR/index.html" ]; then
    ok 'index.html is present'
    if [ -r "$SITE_DIR/index.html" ] || as_user www-data test -r "$SITE_DIR/index.html"; then
      ok 'the web server user can read it'
    else
      warn 'cannot verify that www-data can read the files'
    fi
  else
    warn 'index.html is not there yet (normal before the first deploy)'
  fi
  case "$SITE_DIR" in
    */river|*/river/) ok 'path ends in /river, as DEPLOY_PATH requires' ;;
    *) bad "DEPLOY_PATH must end in /river/; this path is $SITE_DIR" ;;
  esac
else
  bad "directory does not exist (sudo mkdir -p $SITE_DIR && sudo chown -R $DEPLOY_USER:www-data $SITE_DIR)"
fi

# --- sshd -------------------------------------------------------------------
section 'sshd settings'
if SSHD_T="$(as_root sshd -T 2>/dev/null)"; then
  printf '%s\n' "$SSHD_T" | grep -qi '^pubkeyauthentication yes' && ok 'PubkeyAuthentication yes' || bad 'PubkeyAuthentication is not yes'
  printf '%s\n' "$SSHD_T" | grep -qi '^passwordauthentication no' && ok 'PasswordAuthentication no' || warn 'password authentication is enabled; disable it'
  if printf '%s\n' "$SSHD_T" | grep -qi '^allowusers'; then
    if printf '%s\n' "$SSHD_T" | grep -i '^allowusers' | grep -qw "$DEPLOY_USER"; then
      ok 'AllowUsers includes the deploy user'
    else
      bad 'AllowUsers excludes the deploy user'
    fi
  else
    ok 'no AllowUsers restriction'
  fi
else
  warn 'cannot run sshd -T (needs sudo)'
fi

# --- firewall ---------------------------------------------------------------
section 'Firewall'
if FIREWALL="$(as_root iptables -S INPUT 2>/dev/null)"; then
  for p in 80 443; do
    if printf '%s\n' "$FIREWALL" | grep -Eq "^-A INPUT .*--dport $p .*-j ACCEPT"; then
      ok "host firewall accepts TCP $p"
    else
      warn "no ACCEPT rule for TCP $p in iptables INPUT"
    fi
  done
  printf '%s\n' "$FIREWALL" | grep -q -- '-j REJECT' && warn 'INPUT ends with REJECT; rules must be inserted above it' || true
else
  warn 'cannot read iptables (needs sudo)'
fi
if command -v ufw >/dev/null 2>&1; then
  UFW="$(as_root ufw status 2>/dev/null | head -1 || true)"
  [ -n "$UFW" ] && echo "  ufw: $UFW"
  if printf '%s' "${UFW:-}" | grep -qi 'status: active'; then
    as_root ufw status 2>/dev/null | grep -qE '^443(/tcp)? +ALLOW' && ok 'ufw allows 443' || warn 'ufw is active but does not allow 443'
    as_root ufw status 2>/dev/null | grep -qE '^80(/tcp)? +ALLOW' && ok 'ufw allows 80' || warn 'ufw is active but does not allow 80'
  fi
fi

# --- web server -------------------------------------------------------------
section 'Web server'
if command -v nginx >/dev/null 2>&1; then
  if as_root nginx -t >/dev/null 2>&1; then ok 'nginx config is valid'; else warn 'nginx -t reports a problem (needs sudo to see details)'; fi
elif command -v apache2ctl >/dev/null 2>&1; then
  if as_root apache2ctl configtest >/dev/null 2>&1; then ok 'apache config is valid'; else warn 'apache2ctl configtest reports a problem'; fi
elif command -v httpd >/dev/null 2>&1; then
  ok 'httpd is installed'
else
  warn 'neither nginx nor apache2 found on this host'
fi
if command -v curl >/dev/null 2>&1; then
  code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 http://127.0.0.1/river/ || true)"
  case "$code" in
    200) ok 'http://127.0.0.1/river/ answers 200' ;;
    000|'') warn 'nothing answers on http://127.0.0.1/river/' ;;
    *) warn "http://127.0.0.1/river/ answers $code" ;;
  esac
fi

# --- summary ----------------------------------------------------------------
printf '\n%d ok, %d warning(s), %d problem(s)\n' "$pass" "$warnings" "$fail"
if [ "$fail" -gt 0 ]; then
  printf 'Fix the FAIL lines, then run this check again.\n'
  exit 1
fi
printf 'Ready for .github/workflows/deploy.yml (DEPLOY_PATH=%s).\n' "$SITE_DIR"
