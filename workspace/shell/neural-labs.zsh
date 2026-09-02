# Maintained Neural Labs interactive shell profile. User overrides are loaded
# from ~/.zshrc.local at the end, before syntax highlighting is activated.

setopt append_history
setopt auto_cd
setopt auto_pushd
setopt extended_history
setopt hist_expire_dups_first
setopt hist_find_no_dups
setopt hist_ignore_all_dups
setopt hist_reduce_blanks
setopt hist_verify
setopt interactive_comments
setopt pushd_ignore_dups
setopt share_history

HISTFILE="${HISTFILE:-$HOME/.local/state/neural-labs/terminal-history/default}"
HISTSIZE=50000
SAVEHIST=50000
mkdir -p -- "${HISTFILE:h}" "$HOME/.cache/zsh"

autoload -Uz colors compinit up-line-or-beginning-search down-line-or-beginning-search vcs_info
colors
compinit -d "$HOME/.cache/zsh/zcompdump-${ZSH_VERSION}"
zle -N up-line-or-beginning-search
zle -N down-line-or-beginning-search

bindkey -e
bindkey '^[[A' up-line-or-beginning-search
bindkey '^[[B' down-line-or-beginning-search
bindkey '^[[H' beginning-of-line
bindkey '^[[F' end-of-line
bindkey '^[[3~' delete-char

# Insert uses a blinking bar; Overwrite uses a blinking block. ZLE starts each
# new prompt in Insert mode and the Insert key toggles both behavior and cursor.
typeset -g NEURAL_LABS_EDIT_MODE=insert
function neural-labs-line-init() {
  NEURAL_LABS_EDIT_MODE=insert
  print -n -- $'\e[5 q'
}
function neural-labs-line-finish() {
  print -n -- $'\e[1 q'
}
function neural-labs-toggle-overwrite() {
  zle overwrite-mode
  if [[ "$NEURAL_LABS_EDIT_MODE" == insert ]]; then
    NEURAL_LABS_EDIT_MODE=overwrite
    print -n -- $'\e[1 q'
  else
    NEURAL_LABS_EDIT_MODE=insert
    print -n -- $'\e[5 q'
  fi
  zle redisplay
}
zle -N neural-labs-toggle-overwrite
bindkey '^[[2~' neural-labs-toggle-overwrite
autoload -Uz add-zle-hook-widget
add-zle-hook-widget line-init neural-labs-line-init
add-zle-hook-widget line-finish neural-labs-line-finish

zstyle ':completion:*' menu select
zstyle ':completion:*' matcher-list 'm:{a-zA-Z}={A-Za-z}'
zstyle ':vcs_info:git:*' formats '%F{magenta}%b%f'
function neural-labs-vcs-prompt() {
  vcs_info
  RPROMPT="$vcs_info_msg_0_"
}
precmd_functions+=(neural-labs-vcs-prompt)

PROMPT='%F{cyan}%n%f@%F{magenta}%m%f:%F{blue}%~%f %# '
RPROMPT=''

export CLICOLOR=1
export LESS='-FRX'
alias ls='ls --color=auto'
alias grep='grep --color=auto'
alias ll='ls -alF'
alias la='ls -A'
alias l='ls -CF'

if [[ -r /usr/share/zsh-autosuggestions/zsh-autosuggestions.zsh ]]; then
  ZSH_AUTOSUGGEST_HIGHLIGHT_STYLE='fg=8'
  source /usr/share/zsh-autosuggestions/zsh-autosuggestions.zsh
fi

[[ -r "$HOME/.zshrc.local" ]] && source "$HOME/.zshrc.local"

# zsh-syntax-highlighting must be sourced after widgets and user bindings.
if [[ -r /usr/share/zsh-syntax-highlighting/zsh-syntax-highlighting.zsh ]]; then
  source /usr/share/zsh-syntax-highlighting/zsh-syntax-highlighting.zsh
fi
