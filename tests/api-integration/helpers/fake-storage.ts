import { vi } from "vitest";

// Armazenamento em memória no lugar do S3: os testes do Financeiro não
// dependem de rede. `fakeS3(actual)` devolve o módulo storage/s3 com as
// funções de gravar/ler/apagar trocadas; o resto (chaves, limites) é o real.

export const fakeStore = new Map<
  string,
  { bytes: Uint8Array; contentType: string }
>();

export const storageFaults = {
  /** Depois de N gravações bem-sucedidas, as próximas falham. */
  failPutAfter: null as number | null,
  puts: 0,
};

export function resetFakeStorage() {
  fakeStore.clear();
  storageFaults.failPutAfter = null;
  storageFaults.puts = 0;
  vi.stubEnv("S3_ENDPOINT", "http://fake-s3.local");
  vi.stubEnv("S3_BUCKET", "fake-bucket");
  vi.stubEnv("S3_ACCESS_KEY_ID", "test");
  vi.stubEnv("S3_SECRET_ACCESS_KEY", "test");
}

export function fakeS3<T extends Record<string, unknown>>(actual: T): T {
  return {
    ...actual,
    assertStorageConfigured: () => ({}),
    putPrivateObject: async (
      key: string,
      body: Uint8Array,
      contentType: string,
    ) => {
      if (
        storageFaults.failPutAfter !== null &&
        storageFaults.puts >= storageFaults.failPutAfter
      ) {
        throw new Error("storage is down");
      }
      storageFaults.puts += 1;
      fakeStore.set(key, { bytes: new Uint8Array(body), contentType });
    },
    getPrivateObjectBytes: async (key: string) => {
      const object = fakeStore.get(key);
      if (!object) throw new Error("NoSuchKey");
      return object.bytes;
    },
    getPrivateObject: async (key: string) => {
      const object = fakeStore.get(key);
      if (!object) throw new Error("NoSuchKey");
      return {
        body: new Blob([object.bytes as BlobPart]).stream(),
        contentType: object.contentType,
        contentLength: object.bytes.byteLength,
        etag: undefined,
        lastModified: undefined,
      };
    },
    deleteS3Object: async (key: string) => {
      fakeStore.delete(key);
    },
  } as T;
}
