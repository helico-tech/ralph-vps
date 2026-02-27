# shellcheck shell=bash
# 20-nodejs.sh - Install Node.js via nvm

log_section "Node.js (via nvm)"

NVM_DIR="$ACTUAL_HOME/.nvm"

if [[ ! -d "$NVM_DIR" ]]; then
    log_info "Installing nvm..."
    sudo -u "$ACTUAL_USER" bash -c 'curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash'
else
    log_info "nvm already installed."
fi

# Install LTS Node
sudo -u "$ACTUAL_USER" bash -c "
    export NVM_DIR='$NVM_DIR'
    source '$NVM_DIR/nvm.sh'
    nvm install --lts
    nvm use --lts
    nvm alias default 'lts/*'
"

NODE_VERSION="$(sudo -u "$ACTUAL_USER" bash -c "source '$NVM_DIR/nvm.sh' && node --version")"
log_info "Node.js $NODE_VERSION installed."
