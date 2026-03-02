#!/bin/bash
set -euo pipefail

# Create test user
useradd -m -s /bin/bash testuser
mkdir -p /home/testuser/.ssh
chmod 700 /home/testuser/.ssh

# Generate SSH key pair for testing
ssh-keygen -t ed25519 -f /home/testuser/.ssh/id_ed25519 -N "" -C "testuser@ralph-test"
cp /home/testuser/.ssh/id_ed25519.pub /home/testuser/.ssh/authorized_keys
chmod 600 /home/testuser/.ssh/authorized_keys

# Copy private key to a known location for test clients
cp /home/testuser/.ssh/id_ed25519 /tmp/test-ssh-key
chmod 644 /tmp/test-ssh-key

chown -R testuser:testuser /home/testuser/.ssh

# Create project directories
mkdir -p /home/testuser/projects /home/testuser/logs
chown -R testuser:testuser /home/testuser/projects /home/testuser/logs

# Configure git for test user
su - testuser -c "git config --global user.name 'Test User'"
su - testuser -c "git config --global user.email 'test@ralph.dev'"
