/** @type {import('next').NextConfig} */
const nextConfig = {
  images: {
    // Merchant/product images come from many hosts; allow any https host.
    remotePatterns: [{ protocol: "https", hostname: "**" }],
  },
};

export default nextConfig;
