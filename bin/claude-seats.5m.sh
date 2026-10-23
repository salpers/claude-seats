#!/bin/zsh
# SwiftBar plugin: symlink into the SwiftBar plugin folder, keeping the .5m. refresh interval.
# <xbar.title>Claude seats</xbar.title>
# <xbar.desc>Usage across every Claude seat; click a seat to launch it.</xbar.desc>
emulate -L zsh
# SwiftBar starts with a bare PATH, so the Node that runs cc has to be named here.
export PATH="$HOME/.local/share/mise/shims:/opt/homebrew/bin:/usr/local/bin:$PATH"
source "${CLAUDE_SEATS_HOME:-$HOME}/.claude-shared/bin/cc.zsh" || exit
cc menu
