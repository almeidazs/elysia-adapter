import {
	handleMultipartFileFields,
	type UploadField,
	uploadFieldsToMap,
} from '../multipart/handlers/file-fields';
import type { UploadOptions } from '../multipart/options';
import { createInterceptor } from './base-interceptor';

/**
 * Creates a Nest interceptor that extracts files from multiple named fields.
 */
export function FileFieldsInterceptor(
	uploadFields: UploadField[],
	localOptions?: UploadOptions,
): ReturnType<typeof createInterceptor> {
	const fieldsMap = uploadFieldsToMap(uploadFields);

	return createInterceptor(
		localOptions ?? {},
		(req, options) => handleMultipartFileFields(req, fieldsMap, options),
		(req, result) => {
			req.body = result.body;
			req.storageFiles = result.files;
		},
	);
}
