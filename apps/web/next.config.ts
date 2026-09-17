import type { NextConfig } from 'next';

const api = process.env.API_INTERNAL_URL ?? 'http://localhost:4000';

const config: NextConfig = {
  output: 'standalone',
  poweredByHeader: false,
  reactStrictMode: true,
  // الواجهة والخادم على نفس النطاق: الكوكيز httpOnly تعمل دون CORS
  async rewrites() {
    return [{ source: '/api/:path*', destination: `${api}/api/:path*` }];
  },
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'X-Frame-Options', value: 'DENY' },
          // الكاميرا لمسح الـQR من محطة الاستقبال فقط
          { key: 'Permissions-Policy', value: 'camera=(self), microphone=(), geolocation=(), payment=()' },
          { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
        ],
      },
    ];
  },
};

export default config;
