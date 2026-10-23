# The source trace keeps literal paths; prompt expansion escapes newlines in interactive shells.
() {
  emulate -L zsh
  typeset -g _CLAUDE_SEATS_ENTRYPOINT="${${funcsourcetrace[1]%:*}:A:h:h}/src/entrypoint.mjs"
}

cc() {
  emulate -L zsh
  whence -p node >/dev/null 2>&1 || {
    print -r -- 'cc: Node >=24 is required (node not found); put Node 24 or newer on PATH and retry cc.' >&2
    return 1
  }
  local reply
  reply=$(command node "$_CLAUDE_SEATS_ENTRYPOINT" "$@") || return $?
  local -a fields
  fields=("${(@0)reply}")
  case "${fields[1]}" in
    display)
      printf '%s\n' "${fields[2]}"
      ;;
    launch)
      # A failed exec exits the subshell, so refuse missing executables up front.
      whence -p -- "${fields[3]}" >/dev/null 2>&1 || {
        print -r -- 'cc: claude binary not found or not executable' >&2
        return 127
      }
      shift "${fields[4]}"
      if [[ "${1-}" == -r ]]; then
        shift
        set -- --resume "$@"
      fi
      print -r -- "cc: using ${fields[6]}" >&2
      # A subshell keeps the caller's shell alive, so Claude's farewell survives
      # the session, and confines the seat environment to the launch.
      (
        # main must keep CLAUDE_CONFIG_DIR unset even when tests override the seat home.
        export HOME="${fields[5]}"
        if [[ -z "${fields[2]}" ]]; then
          unset CLAUDE_CONFIG_DIR
        else
          export CLAUDE_CONFIG_DIR="${fields[2]}"
        fi
        exec -- "${fields[3]}" "$@"
      )
      ;;
    *)
      print -r -- 'cc: Invalid response from seat selector.' >&2
      return 1
      ;;
  esac
}
