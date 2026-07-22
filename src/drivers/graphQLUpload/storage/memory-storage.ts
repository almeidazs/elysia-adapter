import type { ElysiaRequest } from '../../../types';

import { MemoryUploadFile } from '../Upload';
import { Storage, StorageOptions } from './storage';

/**
 * Stored GraphQL upload metadata for memory-backed files.
 */
export interface MemoryStorageFile extends MemoryUploadFile {
  /** Buffer containing the file data */
  buffer?: Buffer;
  /** Original File object */
  file: File;
}

/**
 * In-memory GraphQL upload storage.
 */
export class MemoryStorage implements Storage<MemoryStorageFile> {
  public readonly options?: StorageOptions;

  /**
   * Creates a memory-backed storage instance.
   */
  constructor(options?: StorageOptions) {
    this.options = options;
  }

  public async handleFile(
    file: File,
    _req: ElysiaRequest,
    fieldName: string,
  ): Promise<MemoryStorageFile> {
    // Check file size limit
    if (this.options?.maxSize && file.size > this.options.maxSize) {
      throw new Error(
        `File "${file.name}" exceeds maximum size of ${this.options.maxSize} bytes`,
      );
    }

    const buffer = Buffer.from(await file.arrayBuffer());

    return {
      fieldName: fieldName,
      originalFilename: file.name,
      mimetype: file.type,
      encoding: '7bit',
      size: buffer.length,
      uploadedAt: new Date().toISOString(),
      buffer,
      file,
    };
  }

  public async removeFile(file: MemoryStorageFile): Promise<void> {
    if ('buffer' in file) {
      (file as MemoryStorageFile & { buffer?: Buffer }).buffer = undefined;
    }
  }
}
