import type { ElysiaRequest } from '../../../types';
import { Readable } from 'stream';

import { ReadStream, ReadStreamOptions, WriteStream } from '../fs-capacitor';
import { StreamUploadFile } from '../Upload';
import { Storage, StorageOptions } from './storage';

/**
 * Stored GraphQL upload metadata for capacitor-backed files.
 */
export interface CapacitorStorageFile extends StreamUploadFile {
  /** Original File object */
  file: File;
  /** Creates a readable stream for the file content */
  createReadStream(options?: ReadStreamOptions): ReadStream;
  /** The write stream capacitor for this file */
  capacitor: WriteStream;
}

/**
 * Temporary-file storage for GraphQL uploads with `createReadStream()` support.
 */
export class CapacitorStorage implements Storage<CapacitorStorageFile> {
  public readonly options?: StorageOptions;

  /**
   * Creates a capacitor-backed storage instance.
   */
  constructor(options?: StorageOptions) {
    this.options = options;
  }

  public async handleFile(
    file: File,
    _req: ElysiaRequest,
    fieldName: string,
  ): Promise<CapacitorStorageFile> {
    // Check file size limit
    if (this.options?.maxSize && file.size > this.options.maxSize) {
      throw new Error(
        `File "${file.name}" exceeds maximum size of ${this.options.maxSize} bytes`,
      );
    }

    // Create capacitor and write file content
    const tmpDir = this.options?.tmpDir;
    const capacitor = new WriteStream(
      tmpDir ? { tmpdir: () => tmpDir } : undefined,
    );

    const buffer = Buffer.from(await file.arrayBuffer());
    Readable.from(buffer).pipe(capacitor);

    // Wait for the stream to finish
    await new Promise<void>((resolve, reject) => {
      capacitor.on('finish', resolve);
      capacitor.on('error', reject);
    });

    return {
      fieldName: fieldName,
      originalFilename: file.name,
      mimetype: file.type,
      encoding: '7bit',
      size: file.size,
      uploadedAt: new Date().toISOString(),
      file,
      createReadStream: (options?: ReadStreamOptions) => {
        const stream = capacitor.createReadStream(options);
        stream.on('close', () => {
          capacitor.release();
        });
        stream.on('error', () => {
          capacitor.release();
        });
        return stream;
      },
      capacitor,
    };
  }

  public async removeFile(file: CapacitorStorageFile): Promise<void> {
    file.capacitor.release();
  }
}
