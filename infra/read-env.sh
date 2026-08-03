#!/bin/sh

# Lê uma chave de um arquivo no formato KEY=value sem executar seu conteúdo.
# Compatível com valores entre aspas usados pelo Docker Compose.
read_env_value() {
  env_key=$1
  env_file=$2
  env_value=$(
    awk -v key="$env_key" '
      index($0, key "=") == 1 {
        value = substr($0, length(key) + 2)
        sub(/\r$/, "", value)
        found = 1
      }
      END {
        if (found) print value
      }
    ' "$env_file"
  )

  case "$env_value" in
    \"*\")
      env_value=${env_value#\"}
      env_value=${env_value%\"}
      ;;
    \'*\')
      env_value=${env_value#\'}
      env_value=${env_value%\'}
      ;;
  esac
  printf '%s' "$env_value"
}
