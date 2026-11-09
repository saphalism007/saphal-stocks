// Hooks the worker provides to route handlers (market snapshot refresh, backup/restore).
export const hooks = {
  checkForUpdate: async (_force: boolean): Promise<{ updated: boolean; version: string | null; asOf: string | null; message: string }> => ({ updated: false, version: null, asOf: null, message: "Not ready" }),
  exportUserDb: (): Uint8Array => new Uint8Array(),
  importUserDb: async (_bytes: Uint8Array): Promise<void> => {},
  marketInfo: (): Record<string, unknown> => ({}),
};
