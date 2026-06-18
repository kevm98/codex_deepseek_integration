#!/usr/bin/env bash
set -euo pipefail

GO_VERSION="${GO_VERSION:-1.26.4}"
GO_MIN_VERSION="${GO_MIN_VERSION:-1.25.0}"
GO_LINUX_AMD64_SHA256="${GO_LINUX_AMD64_SHA256:-1153d3d50e0ac764b447adfe05c2bcf08e889d42a02e0fe0259bd47f6733ad7f}"

CODEX_HOME_DIR="${CODEX_HOME:-$HOME/.codex}"
INSTALL_PREFIX="${INSTALL_PREFIX:-$HOME/.local}"
GO_LINK="${GO_LINK:-$INSTALL_PREFIX/go}"
GO_VERSIONS_DIR="${GO_VERSIONS_DIR:-$INSTALL_PREFIX/share/go}"

MOONBRIDGE_REPO="${MOONBRIDGE_REPO:-https://github.com/ZhiYi-R/moon-bridge.git}"
MOONBRIDGE_REF="${MOONBRIDGE_REF:-main}"
MOONBRIDGE_DIR="${MOONBRIDGE_DIR:-$CODEX_HOME_DIR/moon-bridge}"
MOONBRIDGE_ADDR="${MOONBRIDGE_ADDR:-127.0.0.1:38440}"
MOONBRIDGE_CODEX_BASE_URL="${MOONBRIDGE_CODEX_BASE_URL:-http://127.0.0.1:38440/v1}"

PROFILE_NAME="${PROFILE_NAME:-deepseek-v4-pro}"

log() {
  printf '[install-moonbridge] %s\n' "$*"
}

die() {
  printf '[install-moonbridge] error: %s\n' "$*" >&2
  exit 1
}

require_command() {
  command -v "$1" >/dev/null 2>&1 || die "missing required command: $1"
}

version_ge() {
  local current="$1"
  local minimum="$2"
  local first
  first="$(printf '%s\n%s\n' "$minimum" "$current" | sort -V | head -n 1)"
  [[ "$first" == "$minimum" ]]
}

detect_go_archive() {
  local os arch
  os="$(uname -s)"
  arch="$(uname -m)"
  case "${os}:${arch}" in
    Linux:x86_64|Linux:amd64)
      printf 'linux-amd64 %s\n' "$GO_LINUX_AMD64_SHA256"
      ;;
    *)
      die "unsupported Go archive platform ${os}/${arch}; install Go ${GO_MIN_VERSION}+ manually and rerun"
      ;;
  esac
}

go_is_usable() {
  local go_bin="$1"
  [[ -x "$go_bin" ]] || return 1

  local goversion
  goversion="$("$go_bin" env GOVERSION 2>/dev/null || true)"
  goversion="${goversion#go}"
  [[ -n "$goversion" ]] || return 1
  version_ge "$goversion" "$GO_MIN_VERSION"
}

install_go() {
  local go_bin="${GO_LINK}/bin/go"
  if go_is_usable "$go_bin"; then
    log "Go is already usable at ${go_bin}: $("$go_bin" version)"
    return
  fi

  require_command wget
  require_command tar
  require_command sha256sum

  local platform checksum tarball url target tmp
  read -r platform checksum < <(detect_go_archive)
  tarball="go${GO_VERSION}.${platform}.tar.gz"
  url="https://go.dev/dl/${tarball}"
  target="${GO_VERSIONS_DIR}/go${GO_VERSION}"

  if [[ ! -d "$target" ]]; then
    tmp="$(mktemp -d)"
    log "Downloading ${url}"
    wget -O "${tmp}/${tarball}" "$url"
    printf '%s  %s\n' "$checksum" "${tmp}/${tarball}" | sha256sum -c -
    mkdir -p "$GO_VERSIONS_DIR"
    tar -C "$tmp" -xzf "${tmp}/${tarball}"
    mv "${tmp}/go" "$target"
    log "Left verified Go archive in ${tmp}"
  else
    log "Go ${GO_VERSION} archive is already installed at ${target}"
  fi

  mkdir -p "$INSTALL_PREFIX"
  if [[ -L "$GO_LINK" ]]; then
    ln -sfn "$target" "$GO_LINK"
  elif [[ -e "$GO_LINK" ]]; then
    go_is_usable "${GO_LINK}/bin/go" || die "${GO_LINK} exists and is not a usable Go ${GO_MIN_VERSION}+ install"
  else
    ln -s "$target" "$GO_LINK"
  fi

  go_bin="${GO_LINK}/bin/go"
  go_is_usable "$go_bin" || die "installed Go is not usable at ${go_bin}"
  log "Installed Go: $("$go_bin" version)"
}

ensure_shell_path() {
  local bashrc marker
  bashrc="${HOME}/.bashrc"
  marker="# Codex DeepSeek Moon Bridge Go"

  touch "$bashrc"
  if ! grep -Fq "$marker" "$bashrc"; then
    {
      printf '\n%s\n' "$marker"
      printf 'export PATH="$HOME/.local/go/bin:$PATH"\n'
    } >> "$bashrc"
    log "Added ~/.local/go/bin to ${bashrc}; open a new VS Code terminal to pick it up"
  fi
}

checkout_moonbridge() {
  require_command git

  if [[ -d "${MOONBRIDGE_DIR}/.git" ]]; then
    if ! git -C "$MOONBRIDGE_DIR" diff --quiet || ! git -C "$MOONBRIDGE_DIR" diff --cached --quiet; then
      die "${MOONBRIDGE_DIR} has local changes; commit/stash them or set MOONBRIDGE_DIR to a clean checkout"
    fi
    log "Updating Moon Bridge in ${MOONBRIDGE_DIR}"
    git -C "$MOONBRIDGE_DIR" fetch --depth=1 origin "$MOONBRIDGE_REF"
    git -C "$MOONBRIDGE_DIR" checkout --detach FETCH_HEAD
    return
  fi

  if [[ -e "$MOONBRIDGE_DIR" ]]; then
    die "${MOONBRIDGE_DIR} exists but is not a git checkout"
  fi

  log "Cloning Moon Bridge into ${MOONBRIDGE_DIR}"
  mkdir -p "$(dirname "$MOONBRIDGE_DIR")"
  git init "$MOONBRIDGE_DIR"
  git -C "$MOONBRIDGE_DIR" remote add origin "$MOONBRIDGE_REPO"
  git -C "$MOONBRIDGE_DIR" fetch --depth=1 origin "$MOONBRIDGE_REF"
  git -C "$MOONBRIDGE_DIR" checkout --detach FETCH_HEAD
}

build_moonbridge() {
  local go_bin="${GO_LINK}/bin/go"
  mkdir -p "${CODEX_HOME_DIR}/bin"
  log "Building Moon Bridge"
  "$go_bin" build -C "$MOONBRIDGE_DIR" -o "${CODEX_HOME_DIR}/bin/moonbridge" ./cmd/moonbridge
  log "Built ${CODEX_HOME_DIR}/bin/moonbridge"
}

write_launcher() {
  local launcher="${CODEX_HOME_DIR}/bin/codex-moonbridge"
  mkdir -p "${CODEX_HOME_DIR}/bin"
  cat > "$launcher" <<'SH'
#!/usr/bin/env bash
set -euo pipefail

CODEX_HOME_DIR="${CODEX_HOME:-$HOME/.codex}"
MOONBRIDGE_BIN="${MOONBRIDGE_BIN:-$CODEX_HOME_DIR/bin/moonbridge}"
MOONBRIDGE_ADDR="${MOONBRIDGE_ADDR:-127.0.0.1:38440}"
MOONBRIDGE_LOG_LEVEL="${MOONBRIDGE_LOG_LEVEL:-info}"

if [[ -z "${DEEPSEEK_API_KEY:-}" ]]; then
  echo "DEEPSEEK_API_KEY is not set; export it before starting Moon Bridge." >&2
  exit 2
fi

command -v node >/dev/null 2>&1 || {
  echo "node is required to safely quote DEEPSEEK_API_KEY into the runtime YAML." >&2
  exit 2
}

api_key_json="$(node -e 'process.stdout.write(JSON.stringify(process.env.DEEPSEEK_API_KEY || ""))')"
runtime_root="${XDG_RUNTIME_DIR:-/tmp}/codex-moonbridge"
if ! mkdir -p "$runtime_root" 2>/dev/null || [[ ! -w "$runtime_root" ]]; then
  runtime_root="/tmp/codex-moonbridge-${UID:-$(id -u)}"
fi
runtime_config="${runtime_root}/config.yml"

mkdir -p "$runtime_root"
chmod 700 "$runtime_root" 2>/dev/null || true
umask 077

cat > "$runtime_config" <<YAML
mode: "Transform"

log:
  level: "${MOONBRIDGE_LOG_LEVEL}"
  format: "text"

server:
  addr: "${MOONBRIDGE_ADDR}"

models:
  deepseek-v4-pro:
    context_window: 1000000
    max_output_tokens: 384000
    default_reasoning_level: "high"
    supported_reasoning_levels:
      - effort: "high"
        description: "High reasoning effort"
      - effort: "xhigh"
        description: "Extra high reasoning effort"
    supports_reasoning_summaries: true
    default_reasoning_summary: "auto"
    extensions:
      deepseek_v4:
        enabled: true
  deepseek-v4-flash:
    context_window: 1000000
    max_output_tokens: 384000
    default_reasoning_level: "high"
    supported_reasoning_levels:
      - effort: "high"
        description: "High reasoning effort"
      - effort: "xhigh"
        description: "Extra high reasoning effort"
    supports_reasoning_summaries: true
    default_reasoning_summary: "auto"
    extensions:
      deepseek_v4:
        enabled: true

providers:
  deepseek:
    base_url: "https://api.deepseek.com/anthropic"
    api_key: ${api_key_json}
    offers:
      - model: deepseek-v4-pro
      - model: deepseek-v4-flash

routes:
  moonbridge:
    model: deepseek-v4-pro
    provider: deepseek

defaults:
  model: moonbridge
  max_tokens: 65536
YAML

exec "$MOONBRIDGE_BIN" --config "$runtime_config" "$@"
SH
  chmod 700 "$launcher"
  log "Wrote ${launcher}"
}

write_gpt_profile_if_missing() {
  local profile="${CODEX_HOME_DIR}/gpt55.config.toml"
  [[ -f "$profile" ]] && return
  cat > "$profile" <<'TOML'
model_provider = "openai"
model = "gpt-5.5"
model_reasoning_effort = "xhigh"
TOML
  chmod 600 "$profile"
  log "Wrote ${profile}"
}

generate_codex_profile() {
  local launcher="${CODEX_HOME_DIR}/bin/codex-moonbridge"
  local profile="${CODEX_HOME_DIR}/${PROFILE_NAME}.config.toml"
  local model

  [[ -n "${DEEPSEEK_API_KEY:-}" ]] || die "DEEPSEEK_API_KEY is not set in this shell"

  model="$("$launcher" --print-codex-model)"
  [[ -n "$model" ]] || die "Moon Bridge did not return a Codex model alias"

  log "Generating Codex profile ${profile} for Moon Bridge model ${model}"
  "$launcher" \
    --print-codex-config "$model" \
    --codex-base-url "$MOONBRIDGE_CODEX_BASE_URL" \
    --codex-home "$CODEX_HOME_DIR" \
    > "$profile"
  # Codex 0.141.0 and the public config reference do not accept this generated
  # top-level key. The generated models_catalog.json still contains model
  # output-token metadata, so dropping the profile line keeps strict config valid.
  local sanitized="${profile}.sanitized"
  awk '
    /^\[mcp_servers\.deepwiki\]/ { skip = 1; next }
    /^\[/ && skip { skip = 0 }
    skip { next }
    $1 == "model_max_output_tokens" { next }
    { print }
    $1 == "model_context_window" {
      print "model_reasoning_summary = \"none\""
      print "model_supports_reasoning_summaries = false"
    }
  ' "$profile" > "$sanitized"
  mv "$sanitized" "$profile"
  cat >> "$profile" <<'TOML'

# DeepSeek rejects some inherited connector tool schemas that GPT accepts.
# Disable apps/connectors and connector plugins only for this profile; the base
# GPT config keeps them.
[features]
apps = false

[plugins."gmail@openai-curated"]
enabled = false

[plugins."github@openai-curated"]
enabled = false

[plugins."google-drive@openai-curated"]
enabled = false
TOML
  chmod 600 "$profile"
}

write_systemd_service() {
  local service_dir="${HOME}/.config/systemd/user"
  local service="${service_dir}/codex-moonbridge.service"
  mkdir -p "$service_dir"
  cat > "$service" <<'SERVICE'
[Unit]
Description=Moon Bridge for Codex DeepSeek profile
After=network-online.target

[Service]
Type=simple
Environment=CODEX_HOME=%h/.codex
ExecStart=%h/.codex/bin/codex-moonbridge
Restart=on-failure
RestartSec=3

[Install]
WantedBy=default.target
SERVICE
  chmod 600 "$service"
  log "Wrote ${service}"
}

start_systemd_service_if_available() {
  if ! command -v systemctl >/dev/null 2>&1; then
    log "systemctl is not available; start Moon Bridge with ${CODEX_HOME_DIR}/bin/codex-moonbridge"
    return
  fi

  if ! systemctl --user show-environment >/dev/null 2>&1; then
    log "systemd --user is not reachable; start Moon Bridge with ${CODEX_HOME_DIR}/bin/codex-moonbridge"
    return
  fi

  systemctl --user import-environment DEEPSEEK_API_KEY
  systemctl --user daemon-reload
  systemctl --user enable --now codex-moonbridge.service
  log "Started codex-moonbridge.service"
}

main() {
  require_command node
  require_command codex

  mkdir -p "$CODEX_HOME_DIR"
  install_go
  ensure_shell_path
  checkout_moonbridge
  build_moonbridge
  write_launcher
  write_gpt_profile_if_missing
  generate_codex_profile
  write_systemd_service
  start_systemd_service_if_available

  log "Done. Use: codex --profile ${PROFILE_NAME}"
}

main "$@"
