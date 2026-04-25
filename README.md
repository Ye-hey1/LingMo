# LingMo

LingMo is a cross-platform Markdown note-taking app focused on capture, writing, and AI-assisted knowledge organization. It is built with Next.js, React, Tauri, Rust, and SQLite.

## Acknowledgement

LingMo is based on the open-source [NoteGen](https://github.com/codexu/note-gen) project. Thanks to the NoteGen project and its contributors for the original foundation and open-source work.

This repository is a customized and optimized version of NoteGen, with branding, repository links, RAG indexing, AI request stability, and project structure adjusted for LingMo.

## Features

- Markdown-first local notes.
- AI chat with OpenAI-compatible API providers.
- RAG knowledge retrieval with vector search, BM25, and fuzzy search.
- Quick capture for text, images, todos, and fragmented information.
- MCP and Skills extension support.
- Sync-related modules for GitHub, GitLab, Gitee, S3, and WebDAV.
- Lightweight desktop app powered by Tauri v2 and Rust.

## Optimizations In This Fork

- Rebranded app and repository links to LingMo.
- Optimized RAG indexing with embedding cache, retry, and controlled batch queue.
- Improved AI request reliability with timeout, retry, structured errors, and secret redaction.
- Updated About, Releases, Issues, and Discussions links to this repository.
- Removed the standalone `skills-manager-main` subproject because it is not needed by the current app.

## Tech Stack

| Area | Stack |
| --- | --- |
| Frontend | Next.js 15, React 19, TypeScript, Tailwind CSS |
| Desktop | Tauri v2, Rust |
| Data | SQLite, local filesystem |
| Editor | Tiptap, Markdown |
| AI | OpenAI-compatible API, Embedding, Rerank, RAG |
| Extensions | MCP, Skills |

## Development

### Requirements

- Node.js
- pnpm
- Rust / Cargo
- Tauri system dependencies

### Install

```bash
pnpm install
```

### Web dev server

```bash
pnpm dev
```

### Tauri dev mode

```bash
pnpm tauri dev
```

### Quality check

```bash
pnpm check
```

### Build

```bash
pnpm build
pnpm tauri build
```

## Project Structure

```text
src/
  app/                 # Next.js pages and main UI
  components/          # Shared UI components
  db/                  # SQLite data access layer
  lib/                 # AI, RAG, sync, MCP, and utilities
  stores/              # Zustand stores
src-tauri/
  src/                 # Tauri/Rust backend commands
  tauri.conf.json      # Tauri app config
messages/              # i18n messages
public/                # Static assets
```

## Repository

- GitHub: <https://github.com/Ye-hey1/LingMo>
- Issues: <https://github.com/Ye-hey1/LingMo/issues>
- Releases: <https://github.com/Ye-hey1/LingMo/releases>

## License

Please review the original NoteGen license and keep upstream attribution when redistributing this customized version.
