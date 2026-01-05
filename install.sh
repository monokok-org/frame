#!/usr/bin/env sh
set -e

PACKAGE_NAME="${FRAME_PACKAGE:-@framedev/cli}"
VERSION="${FRAME_VERSION:-}"
PM="${FRAME_PM:-}"

TARGET="$PACKAGE_NAME"
if [ -n "$VERSION" ]; then
  TARGET="$PACKAGE_NAME@$VERSION"
fi

if [ -z "$PM" ]; then
  if command -v pnpm >/dev/null 2>&1; then
    PM="pnpm"
  elif command -v npm >/dev/null 2>&1; then
    PM="npm"
  elif command -v yarn >/dev/null 2>&1; then
    PM="yarn"
  else
    echo "No package manager found. Install Node.js with npm/pnpm/yarn first."
    exit 1
  fi
fi

REGISTRY_ARG=""
if [ -n "${FRAME_REGISTRY:-}" ]; then
  REGISTRY_ARG="--registry=${FRAME_REGISTRY}"
fi

case "$PM" in
  pnpm)
    PNPM_IGNORE_SCRIPTS=false pnpm add -g ${REGISTRY_ARG} "$TARGET"
    ;;
  npm)
    NPM_CONFIG_IGNORE_SCRIPTS=false npm install -g ${REGISTRY_ARG} "$TARGET"
    ;;
  yarn)
    YARN_IGNORE_SCRIPTS=false yarn global add ${REGISTRY_ARG} "$TARGET"
    ;;
  *)
    echo "Unsupported package manager: $PM"
    exit 1
    ;;
esac

echo "Installed $TARGET. Try: frame --help"
