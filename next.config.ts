import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // better-sqlite3 is a native module: keep it out of the bundler.
  serverExternalPackages: ['better-sqlite3'],
  async headers() {
    return [
      {
        // Private media is served from here and nowhere else. `no-referrer` keeps the
        // opaque file id out of any onward request; the route handler sets the same
        // value, but a config header would otherwise win, so it is set here too.
        source: '/api/media/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'no-referrer' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
        ],
      },
      {
        // Everything except the media handler, which is matched above.
        source: '/:path((?!api\\/media).*)',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'X-Frame-Options', value: 'DENY' },
          // `microphone=(self)` is required by the voice recorder, which captures audio
          // in the browser. It was `()` until the voice module shipped, which silently
          // made recording impossible. Camera is same-origin for photo capture; both are
          // still gated by the browser's own permission prompt and by consent in-app.
          { key: 'Permissions-Policy', value: 'camera=(self), microphone=(self), geolocation=()' },
        ],
      },
    ];
  },
};

export default nextConfig;
