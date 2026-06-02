import "./globals.css";
import 'react-photo-view/dist/react-photo-view.css';
import Script from "next/script";
import { AppProviders } from "@/components/providers/AppProviders";

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <>
      <html lang="en" suppressHydrationWarning>
        <head>
          <title>灵墨</title>
          {/* 移动端视口设置 */}
          <meta
            name="viewport"
            content="width=device-width, initial-scale=1.0, maximum-scale=1.0, minimum-scale=1.0, user-scalable=no, viewport-fit=cover, height=device-height"
          />
          <meta name="mobile-web-app-capable" content="yes" />
          <meta name="apple-mobile-web-app-capable" content="yes" />
          <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
          {/* Define isSpace function globally to fix markdown-it issues with Next.js + Turbopack
          https://github.com/markdown-it/markdown-it/issues/1082#issuecomment-2749656365 */}
          <Script id="markdown-it-fix" strategy="beforeInteractive">
            {`
              if (typeof window !== 'undefined' && typeof window.isSpace === 'undefined') {
                window.isSpace = function(code) {
                  return code === 0x20 || code === 0x09 || code === 0x0A || code === 0x0B || code === 0x0C || code === 0x0D;
                };
              }
            `}
          </Script>
          <Script id="chunk-error-recovery" strategy="beforeInteractive">
            {`
              (function () {
                var pattern = /ChunkLoadError|Loading chunk|Failed to fetch dynamically imported module|importing a module script failed/i;
                function messageFrom(value) {
                  if (!value) return '';
                  if (typeof value === 'string') return value;
                  if (value.message) return String(value.name || '') + ' ' + String(value.message);
                  if (value.reason) return messageFrom(value.reason);
                  if (value.error) return messageFrom(value.error);
                  return String(value);
                }
                function reloadOnce() {
                  try {
                    var key = 'chunk-error-reload';
                    var now = Date.now();
                    var lastReload = Number(sessionStorage.getItem(key) || 0);
                    if (now - lastReload < 3000) return;
                    sessionStorage.setItem(key, String(now));
                  } catch (_) {}
                  window.location.reload();
                }
                window.addEventListener('error', function (event) {
                  var target = event && event.target;
                  var src = target && (target.src || target.href);
                  if ((src && /\\/_next\\/static\\/chunks\\//.test(String(src))) || pattern.test(messageFrom(event.error || event.message || event))) {
                    event.preventDefault();
                    reloadOnce();
                  }
                }, true);
                window.addEventListener('unhandledrejection', function (event) {
                  if (pattern.test(messageFrom(event.reason || event))) {
                    event.preventDefault();
                    reloadOnce();
                  }
                });
              })();
            `}
          </Script>
        </head>
        <body suppressHydrationWarning>
          <AppProviders>{children}</AppProviders>
        </body>
      </html>
    </>
  );
}
