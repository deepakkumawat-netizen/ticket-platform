// See storage.service.ts's comment for why the default implementation is
// Postgres-backed rather than local disk. Anything calling this interface
// (attachments.service.ts) never knows or cares which backend is behind
// it — swapping to S3 later means writing a new class that implements this,
// nothing else changes.
export interface StorageBackend {
  save(buffer: Buffer, mimeType: string): Promise<string>; // returns an opaque storageKey
  read(storageKey: string): Promise<{ buffer: Buffer; mimeType: string } | null>;
  delete(storageKey: string): Promise<void>;
}
