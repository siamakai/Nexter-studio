import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // pdfkit loads font files at runtime — must not be bundled by webpack
  serverExternalPackages: ['pdfkit', 'fontkit', 'linebreak'],
};

export default nextConfig;
