import { handleMultipartMultipleFiles } from '../multipart/handlers/multiple-files';
import type { UploadOptions } from '../multipart/options';
import { createInterceptor } from './base-interceptor';

/**
 * Creates a Nest interceptor that extracts multiple files from one field.
 */
export function FilesInterceptor(
	fieldname: string,
	maxCount = 1,
	localOptions?: UploadOptions,
): ReturnType<typeof createInterceptor> {
	return createInterceptor(
		localOptions ?? {},
		(req, options) =>
			handleMultipartMultipleFiles(req, fieldname, maxCount, options),
		(req, result) => {
			req.body = result.body;
			req.storageFiles = result.files;
		},
	);
}
