// Lets plain `node` import the repo's TypeScript helpers (e2e/chain.ts imports
// '../web/src/lib/jsonrpc' without an extension). Node strips the types itself;
// this hook only adds the missing '.ts'.
//
//   node --import ./video/ts-resolve.mjs video/<script>.mjs
import { registerHooks } from 'node:module';

registerHooks({
  resolve(specifier, context, nextResolve) {
    try {
      return nextResolve(specifier, context);
    } catch (e) {
      if (/^\.{1,2}\//.test(specifier) && !/\.[cm]?[jt]s$|\.json$/.test(specifier)) {
        return nextResolve(`${specifier}.ts`, context);
      }
      throw e;
    }
  },
});
