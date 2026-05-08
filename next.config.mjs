/** @type {import('next').NextConfig} */
const nextConfig = {
  // sharp + @contentauth/c2pa-node have native binaries — keep them out of
  // the client bundle and let the server route resolve them at runtime.
  experimental: {
    serverComponentsExternalPackages: [
      "sharp",
      "@contentauth/c2pa-node",
    ],
  },
  webpack: (config, { isServer }) => {
    // wagmi/RainbowKit pull in optional Node-only deps; mark them external on the client.
    config.externals.push("pino-pretty", "lokijs", "encoding");
    // @metamask/sdk references @react-native-async-storage; we never run in RN, so stub it.
    config.resolve.fallback = {
      ...(config.resolve.fallback || {}),
      "@react-native-async-storage/async-storage": false,
    };
    if (!isServer) {
      // Browser bundle never needs the Node-side native libs.
      config.resolve.fallback = {
        ...config.resolve.fallback,
        sharp: false,
      };
    }
    return config;
  },
};

export default nextConfig;
