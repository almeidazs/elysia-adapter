import { randomBytes } from 'node:crypto';
import { stat } from 'node:fs/promises';
import { extname } from 'node:path';

export const pathExists = async (path: string) => {
	try {
		await stat(path);
		return true;
	} catch {
		return false;
	}
};

export const getUniqueFilename = async (filename: string) => {
	const buffer = randomBytes(16);
	const ext = extname(filename);
	return buffer.toString('hex') + ext;
};
