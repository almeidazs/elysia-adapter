import { createParamDecorator, type ExecutionContext } from '@nestjs/common';

import { getMultipartRequest } from '../multipart/request';
import type { StorageFile } from '../storage/storage';

/**
 * Returns the single uploaded file assigned by the active file interceptor.
 */
export const UploadedFile = createParamDecorator(
	async (_data, ctx: ExecutionContext): Promise<StorageFile | undefined> => {
		const req = getMultipartRequest(ctx.switchToHttp());

		return req?.storageFile;
	},
);
