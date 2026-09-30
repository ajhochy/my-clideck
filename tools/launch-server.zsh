#!/bin/zsh
# launchd-invoked entrypoint for the personal CliDeck server on port 4002.
#
# We set PATH explicitly rather than sourcing ~/.zshrc — the user's .zshrc has
# a syntax error that aborts the script when launchd's environment is minimal.
# This PATH covers the locations CliDeck-spawned sessions actually need
# (claude in ~/.local/bin, gemini in /usr/local/bin, etc).

echo "PRE-EXEC HOME=$HOME PATH=$PATH PWD=$(pwd) at $(date -u)" >> /tmp/clideck-launch-debug.log

export HOME="/Users/ajhochhalter"
export PATH="$HOME/.npm-global/bin:$HOME/.local/bin:/opt/homebrew/bin:/opt/homebrew/sbin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"

mkdir -p "$HOME/Library/Logs/my-clideck" || { echo "mkdir failed at $(date -u)" >> /tmp/clideck-launch-debug.log; exit 1; }
echo "MID-EXEC about to redirect at $(date -u)" >> /tmp/clideck-launch-debug.log
exec >>"$HOME/Library/Logs/my-clideck/server.log" 2>>"$HOME/Library/Logs/my-clideck/server.err"
print -u 2 "=== launch-server.zsh starting at $(date -u) HOME=$HOME PATH=$PATH ==="

cd "$HOME/Documents/my-clideck"
exec /usr/local/bin/node server.js --port 4002 --host 0.0.0.0
