import { BadRequestException } from '@nestjs/common';
import type { ElysiaRequest } from '../../types';
import type {
	DiskStorageFile,
	MemoryStorageFile,
	StorageFile,
} from '../storage';
import type { UploadOptions } from '.';

/**
 * File metadata shape accepted by multipart filters.
 */
export type UploadFilterFile =
	| DiskStorageFile
	| MemoryStorageFile
	| StorageFile;

/**
 * User-provided filter callback for multipart uploads.
 */
export type UploadFilterHandler = (
	req: ElysiaRequest,
	file: UploadFilterFile,
) => Promise<boolean | string> | boolean | string;

/**
 * Applies the configured multipart filter and handles cleanup on rejection.
 */
export const filterUpload = async (
	uploadOptions: UploadOptions,
	req: ElysiaRequest,
	file: UploadFilterFile,
): Promise<boolean> => {
	if (uploadOptions.filter == null) {
		return true;
	}

	try {
		const res = await uploadOptions.filter(req, file);

		if (typeof res === 'string') {
			throw new BadRequestException(res);
		}

		return res;
	} catch (error) {
		await uploadOptions.storage?.removeFile(file, true);
		throw error;
	}
};
