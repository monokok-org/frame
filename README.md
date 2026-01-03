# Frame

A coding agent optimized for local LLMs, with a custom TUI.

## Caution

> This project is highly experimental right now. Use for testing only.

## Install

From npm (recommended):

```sh
npm install -g @framedev/cli
```

Using pnpm:

```sh
pnpm add -g @framedev/cli
```

Using the install script (from the repo or a release asset):

```sh
./install.sh
```

Optional overrides:

```sh
FRAME_VERSION=2.0.0 FRAME_PM=npm ./install.sh
```

From source:

```sh
pnpm install
pnpm --filter @framedev/cli build
npm install -g ./packages/cli
```

After install, run `frame --help`.

## Ollama setup (recommended)

Frame expects a running Ollama server and a tool-calling model.

1. Start the server:
   ```sh
   ollama serve
   ```
2. Pull a supported model (default is devstral-small-2:24b):
   ```sh
   ollama pull devstral-small-2:24b
   ollama pull qwen2.5-coder:14b
   ```
3. If needed, update `~/.frame/settings.json` with your Ollama URL/model.

Notes:
- Use official Ollama models/images that support tool calling; custom GGUF/GGML builds may not work.
- Default Ollama context (often 4k) is too small for real coding workflows; set at least 32k.

### Increase Ollama context length

Set a larger context window (example: 32k). You can do this one of two ways:

Temporary (shell session):
```sh
OLLAMA_CONTEXT_LENGTH=32000 ollama serve
```

Systemd (persistent on Linux):
```sh
sudo systemctl edit ollama
```
Add:
```ini
[Service]
Environment=OLLAMA_CONTEXT_LENGTH=32000
```
Then reload and restart:
```sh
sudo systemctl daemon-reload
sudo systemctl restart ollama
```

Verify:
```sh
ollama ps
```

Note: 32k context was tested on RTX 5060 Ti 16GB; increase only if your GPU/CPU can handle it.

## Environment variables

Frame reads `~/.frame/settings.json` and environment variables at runtime (env wins). `.env` is intended for local development in this repo. Defaults below come from `packages/cli/src/utils/config.ts`.

### Runtime configuration

- `LLM_BASE_URL` (default `http://localhost:11434/v1`): Base URL for the LLM API.
- `LLM_MODEL` (default `devstral-small-2:24b`): Chat model name.
- `LLM_API_KEY` (default `x`): API key for OpenAI-compatible endpoints.
- `EMBEDDING_MODEL` (default `nomic-embed-text`): Embedding model name.
- `MAX_FILE_SIZE_MB` (default `10`): Max file size allowed for read/edit.
- `COMMAND_TIMEOUT_MS` (default `30000`): Command execution timeout.
- `ALLOW_DESTRUCTIVE_COMMANDS` (default `false`): Allow dangerous commands when `true`.
- `LOG_LEVEL` (default `info`): Logging level.

### Debug and advanced

- `FRAME_DEBUG` (default `true`): Set to `false` to disable debug logging.
- `LLM_DEBUG_REQUESTS` (default `false`): Set to `true` to log LLM request payloads.
- `OLLAMA_NATIVE_TOOLS` (default `auto`): `true` forces Ollama native tool mode, `false` forces OpenAI-compatible; auto-detects when unset.
- `FRAMEBASE_URL` (default `http://localhost:8080/query`): Framebase service URL (baked at build time if set during `pnpm build`, and still overridable at runtime).
- `FRAMEBASE_TIMEOUT_MS` (default `3000`): Framebase request timeout.
- `FRAMEBASE_LIMIT` (default `5`): Default number of frames to fetch.
- `FRAMEBASE_MAX_FRAME_CHARS` (default `3000`): Max chars per frame stored in context.
- `FRAMEBASE_ENABLED` (default `true`): Set to `false` to disable Framebase.

### Install script overrides

- `FRAME_PACKAGE` (default `@framedev/cli`): Package to install with `install.sh`.
- `FRAME_VERSION` (default latest): Version tag to install.
- `FRAME_PM` (default auto-detect): Force package manager (`npm`, `pnpm`, `yarn`).
- `FRAME_REGISTRY` (default npm registry): Custom registry URL.

## Project Structure

This is a **pnpm monorepo** containing:

- **@framedev/cli** - Main coding agent application
- **@framedev/tui** - Custom TUI framework
- **legacy/** - Archived prompts, experiments, and prior implementations

## Releasing

Create a changeset:

```sh
pnpm changeset
```

Version packages:

```sh
pnpm version
```

Publish:

```sh
pnpm release
```
