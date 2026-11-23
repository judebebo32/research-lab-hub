export async function resolve(spec, ctx, next) {
  if (spec === "@anthropic-ai/sdk") return { url: new URL("./stub-anthropic.mjs", import.meta.url).href, shortCircuit: true };
  if (spec === "@netlify/blobs") return { url: new URL("./stub-blobs.mjs", import.meta.url).href, shortCircuit: true };
  if (spec === "@netlify/identity") return { url: new URL("./stub-identity.mjs", import.meta.url).href, shortCircuit: true };
  return next(spec, ctx);
}
