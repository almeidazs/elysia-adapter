import { BadRequestException } from '@nestjs/common';

import type { StorageFile } from '../../storage/storage';
import type { UploadOptions } from '../options';
import type { TElysiaRequest } from '../request';
import { FileHandler, type MultipleFilesResult } from './base-handler';

export const handleMultipartMultipleFiles = async (
	req: TElysiaRequest,
	fieldname: string,
	maxCount: number,
	options: UploadOptions,
): Promise<MultipleFilesResult> => {
	const handler = new FileHandler(req, options);
	const files: StorageFile[] = [];

	await handler.process(async (fieldName, part) => {
		if (!(part instanceof File)) {
			throw new BadRequestException(
				`Field ${fieldName} contains invalid file data`,
			);
		}

		handler.validateFieldName(fieldName, fieldname);
		handler.validateMaxCount(fieldName, files.length, maxCount);

		const storageFile = await handler.handleSingleFile(fieldName, part);
		if (storageFile) {
			files.push(storageFile);
			handler.addFile(fieldName, storageFile);
		}
	});

	return {
		body: handler.getBody(),
		files,
		remove: handler.createRemoveFunction(),
	};
};
