/** @type {import('next').NextConfig} */
const nextConfig = {
  // Transformers.js' Node entry references its bundled ONNX-Runtime WASM as
  // a JS module, which webpack can't resolve at build time. We only ever
  // dynamic-import it on the client, so mark the package (plus its Node-only
  // peers) as runtime-external on the server. (Next 14 spelling.)
  experimental: {
    serverComponentsExternalPackages: [
      "@huggingface/transformers",
      "sharp",
      "onnxruntime-node",
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
      // Browser bundle never needs the Node ORT or sharp; stub them so
      // webpack doesn't try to bundle their native deps.
      config.resolve.fallback = {
        ...config.resolve.fallback,
        sharp: false,
        "onnxruntime-node": false,
      };
    }
    // onnxruntime-web ships .mjs files that use top-level `import.meta` and
    // ES module syntax. Webpack defaults to parsing them as auto-detected
    // CJS, which fails on those tokens. Force ESM parsing for any .mjs we
    // encounter inside node_modules and relax the strict module-resolution
    // that ESM specifies (some sub-imports omit the extension).
    config.module.rules.push({
      test: /\.m?js$/,
      type: "javascript/auto",
      resolve: { fullySpecified: false },
    });
    return config;
  },
};

export default nextConfig;
