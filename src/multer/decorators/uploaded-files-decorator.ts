import { createParamDecorator, type ExecutionContext } from '@nestjs/common';

import { getMultipartRequest } from '../multipart/request';
import type { StorageFile } from '../storage/storage';

/**
 * Returns the uploaded files assigned by the active multipart interceptor.
 */
export const UploadedFiles = createParamDecorator(
  async (
    _data: unknown,
    ctx: ExecutionContext,
  ): Promise<Record<string, StorageFile[]> | StorageFile[] | undefined> => {
    const req = getMultipartRequest(ctx.switchToHttp());

    return req?.storageFiles;
  },
);
