# LingMo Docs

This folder contains the standalone LingMo documentation site.

## Development

```bash
pnpm install
pnpm --filter lingmo-docs dev
```

## Build

```bash
pnpm --filter lingmo-docs build
```

The site is statically exported to `docs/out`.

## Vercel

Deploy this folder as an independent Vercel project:

- Root Directory: `docs`
- Framework Preset: `Next.js`
- Install Command: `pnpm install`
- Build Command: `pnpm build`
- Output Directory: `out`
- Domain: `lingmonote.cc.cd`
