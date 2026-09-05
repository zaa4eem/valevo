/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ['@zaa4eem/shared'],
  reactStrictMode: true,
  output: 'standalone',
  experimental: {
    // Cross-fades between routes instead of the hard swap App Router does
    // by default. Elements that carry a view-transition-name (see
    // tokens.css) morph between pages rather than being torn down and
    // rebuilt; browsers without the API just navigate as before.
    viewTransition: true,
  },
};

module.exports = nextConfig;
