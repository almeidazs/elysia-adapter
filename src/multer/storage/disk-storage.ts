import { createWriteStream } from 'fs';
import { mkdir, unlink } from 'fs/promises';
import type { ElysiaRequest } from '../../types';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { tmpdir } from 'os';
import { join } from 'path';

import { getUniqueFilename, pathExists } from '../fs';
import { StorageFile, Storage } from './storage';

/**
 * Stored multipart file metadata for disk-backed uploads.
 */
export interface DiskStorageFile extends StorageFile {
  dest: string;
  filename: string;
  path: string;
}

type DiskStorageOptionHandler =
  | ((file: File, req: ElysiaRequest) => Promise<string> | string)
  | string;

/**
 * Options for the disk-backed multipart storage implementation.
 */
export interface DiskStorageOptions {
  dest?: DiskStorageOptionHandler;
  filename?: DiskStorageOptionHandler;
  removeAfter?: boolean;
}

const excecuteStorageHandler = (
  file: File,
  req: ElysiaRequest,
  obj?: DiskStorageOptionHandler,
) => {
  if (typeof obj === 'function') {
    return obj(file, req);
  }

  if (obj != null) return obj;

  return null;
};

const ENV_TESTS_STORAGE_TMP_PATH = process.env.__TESTS_TMP_PATH__;

/**
 * Disk-based multipart storage implementation.
 */
export class DiskStorage
  implements Storage<DiskStorageFile, DiskStorageOptions>
{
  public readonly options?: DiskStorageOptions;

  /**
   * Creates a disk-backed storage instance.
   */
  constructor(options?: DiskStorageOptions) {
    this.options = options;

    if (ENV_TESTS_STORAGE_TMP_PATH != null) {
      this.options = { ...this.options, dest: ENV_TESTS_STORAGE_TMP_PATH };
    }
  }

  /**
   * Writes the uploaded file to disk and returns its metadata.
   */
  public async handleFile(file: File, req: ElysiaRequest, fieldName: string) {
    const filename = await this.getFilename(file, req, this.options?.filename);
    const dest = await this.getFileDestination(file, req, this.options?.dest);

    if (!(await pathExists(dest))) {
      await mkdir(dest, { recursive: true });
    }

    const path = join(dest, filename);
    const stream = createWriteStream(path);

    const buffer = await file.arrayBuffer();
    const readableStream = Readable.from(Buffer.from(buffer));

    await pipeline(readableStream, stream);

    return {
      size: stream.bytesWritten,
      dest,
      filename,
      originalFilename: file.name,
      path,
      mimetype: file.type,
      encoding: 'utf-8',
      fieldName: fieldName,
      uploadedAt: new Date().toISOString(),
    };
  }

  /**
   * Removes a stored file when cleanup is enabled.
   */
  public async removeFile(file: StorageFile | DiskStorageFile, force?: boolean) {
    if (!this.options?.removeAfter && !force) return;

    if ('path' in file) {
      await unlink(file.path);
    }
  }

  protected async getFilename(
    file: File,
    req: ElysiaRequest,
    obj?: DiskStorageOptionHandler,
  ): Promise<string> {
    return (
      excecuteStorageHandler(file, req, obj) ?? getUniqueFilename(file.name)
    );
  }

  protected async getFileDestination(
    file: File,
    req: ElysiaRequest,
    obj?: DiskStorageOptionHandler,
  ): Promise<string> {
    return excecuteStorageHandler(file, req, obj) ?? tmpdir();
  }
}
