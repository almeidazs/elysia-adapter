import type { ElysiaRequest } from '../../types';

import { StorageFile, Storage } from './storage';

/**
 * Stored multipart file metadata for memory-backed uploads.
 */
export interface MemoryStorageFile extends StorageFile {
  buffer?: Buffer;
  stream: () => ReadableStream<Uint8Array>;
}

/**
 * In-memory multipart storage implementation.
 */
export class MemoryStorage implements Storage<MemoryStorageFile> {
  /**
   * Stores the full multipart file in memory.
   */
  public async handleFile(
    file: File,
    _req: ElysiaRequest,
    fieldName: string,
  ): Promise<MemoryStorageFile> {
    const buffer = await file
      .stream()
      .pipeTo(new WritableStream())
      .then(() => file.arrayBuffer())
      .then((buf) => Buffer.from(buf));

    return {
      buffer,
      size: buffer.length,
      encoding: 'utf-8',
      mimetype: file.type,
      fieldName: fieldName,
      originalFilename: file.name,
      uploadedAt: new Date().toISOString(),
      stream: () => file.stream(),
    };
  }

  /**
   * Releases the in-memory buffer reference.
   */
  public async removeFile(file: StorageFile): Promise<void> {
    // Check if it's a MemoryStorageFile before deleting buffer
    if ('buffer' in file) {
      (file as MemoryStorageFile & { buffer?: Buffer }).buffer = undefined;
    }
  }
}
