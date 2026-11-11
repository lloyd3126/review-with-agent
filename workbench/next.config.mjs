import path from 'node:path';
import {fileURLToPath} from 'node:url';
const application = path.dirname(fileURLToPath(import.meta.url));
const config = {
  poweredByHeader: false,
  reactStrictMode: true,
  outputFileTracingRoot: path.resolve(application,'..'),
  turbopack: {root:path.resolve(application,'..')},
};
export default config;
