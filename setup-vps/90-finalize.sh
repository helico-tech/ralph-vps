# shellcheck shell=bash
# 90-finalize.sh - Make scripts executable, print next steps

chmod +x "$SCRIPT_DIR/setup-vps.sh"
chmod +x "$SCRIPT_DIR"/bin/*.sh

log_info "Scripts marked executable."

log_section "Setup Complete!"

echo ""
echo -e "${BOLD}Next steps:${NC}"
echo ""
echo "  0. Reload your shell so nvm/node/claude are on PATH:"
echo "     source ~/.bashrc"
echo ""
echo "  1. Authenticate Claude (run as your user, NOT root):"
echo "     claude"
echo "     (Follow the on-screen instructions to log in)"
echo ""
echo "  2. Add the SSH key above to GitHub:"
echo "     https://github.com/settings/keys"
echo ""
echo "  3. Add your first project:"
echo "     ./bin/add-project.sh my-app git@github.com:user/my-app.git"
echo ""
echo "  4. Edit the task prompt:"
echo "     nano projects/my-app/PROMPT.md"
echo ""
echo "  5. Start the loop:"
echo "     ./bin/start-loop.sh my-app"
echo ""
echo -e "See ${BLUE}docs/VPS-SETUP.md${NC} for the full guide."
