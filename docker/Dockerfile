# Ralph VPS — Autonomous coding agent
# Runs the orchestrator loop against a mounted project repo

FROM node:20-slim AS base

# Install system dependencies
RUN apt-get update && \
    apt-get install -y --no-install-recommends git curl ca-certificates unzip && \
    rm -rf /var/lib/apt/lists/*

# Install Bun to system path
RUN curl -fsSL https://bun.sh/install | bash && \
    cp /root/.bun/bin/bun /usr/local/bin/bun && \
    rm -rf /root/.bun

# Install Claude CLI
RUN npm install -g @anthropic-ai/claude-code

# Copy Ralph source
WORKDIR /opt/ralph
COPY package.json bun.lock* ./
RUN bun install --production --frozen-lockfile
COPY src/ src/
COPY templates/ templates/

# Create non-root user
RUN useradd -r -u 1001 -m -s /bin/bash ralph && \
    chown -R ralph:ralph /opt/ralph

# Git config for Ralph commits
USER ralph
RUN git config --global user.name "Ralph" && \
    git config --global user.email "ralph@helico.dev"

# The target project is mounted here
WORKDIR /workspace

# Healthcheck: verify the workspace is a git repo with commits
HEALTHCHECK --interval=60s --timeout=5s --retries=3 \
    CMD git rev-parse --is-inside-work-tree 2>/dev/null || exit 1

ENTRYPOINT ["bun", "run", "/opt/ralph/src/cli.ts"]
CMD ["start"]
