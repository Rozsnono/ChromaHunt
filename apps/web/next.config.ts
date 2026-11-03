import type { NextConfig } from 'next';

const config: NextConfig = {
  poweredByHeader: false,
  reactStrictMode: true,
  transpilePackages: ['@chromahunt/shared'],
  // Native modules must not be bundled.
  serverExternalPackages: ['@node-rs/argon2', 'sharp', 'mongoose'],
};

export default config;
