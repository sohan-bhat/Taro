const path = require('path');

/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ['@taro/shared'],
  poweredByHeader: false,
  // The Docker image builds a self-contained server; Vercel ignores this path.
  ...(process.env.NEXT_OUTPUT === 'standalone'
    ? {
        output: 'standalone',
        experimental: { outputFileTracingRoot: path.join(__dirname, '../../') },
      }
    : {}),

  async headers() {
    const security = [
      { key: 'X-Content-Type-Options', value: 'nosniff' },
      { key: 'X-Frame-Options', value: 'DENY' },
      { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
      { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
    ];
    return [
      { source: '/:path*', headers: security },
      // The sign-in callback URL carries a one-time code; never leak it in a Referer.
      { source: '/auth/callback', headers: [{ key: 'Referrer-Policy', value: 'no-referrer' }] },
    ];
  },

  async redirects() {
    // Dashboard links from before sign-in existed carried a workspace ID
    return [{ source: '/dashboard/:id', destination: '/dashboard', permanent: false }];
  },
};

module.exports = nextConfig;
