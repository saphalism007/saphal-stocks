// Some shared modules read process.env; give the worker an empty one.
const g = globalThis as unknown as { process?: { env: Record<string, string | undefined> } };
if (!g.process) g.process = { env: {} };
export {};
