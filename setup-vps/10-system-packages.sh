# shellcheck shell=bash
# 10-system-packages.sh - Install core system packages

log_section "System packages"

apt-get update -qq
apt-get install -y -qq \
    tmux git curl jq build-essential unzip \
    python3 python3-pip python3-venv \
    ca-certificates gnupg

log_info "System packages installed."
