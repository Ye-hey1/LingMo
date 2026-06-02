import createNextIntlPlugin from 'next-intl/plugin';
import type { NextConfig } from "next";
import webpack from 'webpack';


const isProd = process.env.NODE_ENV === 'production';
const allowedDevOrigins = Array.from(
  new Set([
    process.env.TAURI_DEV_HOST,
    '127.0.0.1',
    'localhost',
  ].filter((origin): origin is string => Boolean(origin)))
);

const withNextIntl = createNextIntlPlugin();

const nextConfig: NextConfig = {
  /* config options here */
  output: isProd ? "export" : undefined,
  images: {
    unoptimized: true,
  },
  skipTrailingSlashRedirect: true,
  allowedDevOrigins,
  sassOptions: {
    silenceDeprecations: ['legacy-js-api'],
  },
  reactStrictMode: false,
  turbopack: {},
  devIndicators: false,
  eslint: {
    dirs: ['src'],
    ignoreDuringBuilds: true,
  },
  typescript: {
    ignoreBuildErrors: true,
  },
  experimental: {
    optimizePackageImports: [
      'lucide-react',
      'lodash-es',
      'date-fns',
      '@radix-ui/react-accordion',
      '@radix-ui/react-alert-dialog',
      '@radix-ui/react-dialog',
      '@radix-ui/react-dropdown-menu',
      '@radix-ui/react-popover',
      '@radix-ui/react-select',
      '@radix-ui/react-tabs',
      '@radix-ui/react-tooltip',
    ],
  },
  webpack: (config, { isServer }) => {
    if (isServer) {
      config.resolve.alias = {
        ...config.resolve.alias,
        '@tauri-apps/api': false,
        '@tauri-apps/api/core': false,
        '@tauri-apps/api/path': false,
        '@tauri-apps/api/event': false,
        '@tauri-apps/plugin-fs': false,
        '@tauri-apps/plugin-dialog': false,
        '@tauri-apps/plugin-store': false,
        '@tauri-apps/plugin-opener': false,
        '@tauri-apps/plugin-os': false,
        '@tauri-apps/plugin-clipboard-manager': false,
        '@tauri-apps/plugin-global-shortcut': false,
        '@tauri-apps/plugin-http': false,
        '@tauri-apps/plugin-process': false,
        '@tauri-apps/plugin-shell': false,
        '@tauri-apps/plugin-sql': false,
        '@tauri-apps/plugin-updater': false,
        '@tauri-apps/plugin-window-state': false,
      };
    }

    if (!isServer) {
      // pptxgenjs v4.x uses dynamic import('node:fs') and import('node:https')
      // which are not available in browser builds.
      config.plugins.push(
        new webpack.IgnorePlugin({
          resourceRegExp: /^node:(fs|https)$/,
        })
      );
    }

    return config;
  },
};

export default withNextIntl(nextConfig);
