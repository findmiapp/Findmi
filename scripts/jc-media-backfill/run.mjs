// Loader for the one-off Jersey City media backfill: runs the TypeScript
// source with Node's type stripping, resolving the app's "@/…" imports and
// stubbing Next's "server-only" marker (the same hooks the test suite uses).
import { registerHooks } from "node:module";

registerHooks({
  resolve(specifier, context, next) {
    if (specifier === "server-only") return { url: "data:text/javascript,export{}", shortCircuit: true };
    if (specifier.startsWith("@/")) return next(new URL(`../../src/${specifier.slice(2)}.ts`, import.meta.url).href, context);
    try {
      return next(specifier, context);
    } catch (err) {
      if (specifier.startsWith(".")) return next(`${specifier}.ts`, context);
      throw err;
    }
  },
});

await import("./backfill.ts");
