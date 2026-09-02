/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ['@zaa4eem/shared'],
  reactStrictMode: true,
  output: 'standalone',
};

module.exports = nextConfig;
