import type { StorageFile } from '../../storage/storage';
import type { UploadOptions } from '../options';
import type { TElysiaRequest } from '../request';
import { FileHandler, type SingleFileResult } from './base-handler';

/**
 * Handles a single file upload in a multipart request.
 * @param req - The request object.
 * @param fieldname - The name of the field that should contain the file.
 * @param options - Upload options with storage configurations.
 * @returns An object containing the request body, uploaded file, and a remove function.
 */
export const handleMultipartSingleFile = async (
	req: TElysiaRequest,
	fieldname: string,
	options: UploadOptions,
): Promise<SingleFileResult> => {
	const handler = new FileHandler(req, options);
	let file: StorageFile | undefined;

	await handler.process(async (fieldName, part) => {
		handler.validateFieldName(fieldName, fieldname);
		handler.validateSingleFile(file);

		const storageFile = await handler.handleSingleFile(fieldName, part);
		if (storageFile) {
			file = storageFile;
			handler.addFile(fieldName, storageFile);
		}
	});

	return {
		body: handler.getBody(),
		file,
		remove: handler.createRemoveFunction(),
	};
};
