import type { ElysiaRequest } from '../../types';

import { CapacitorStorage } from './storage/capacitor-storage';
import type { Storage } from './storage/storage';
import { type MemoryUploadFile, Upload } from './Upload';

/**
 * Options for processing GraphQL file uploads
 */
export interface ProcessRequestOptions {
	/** Storage implementation to use for uploaded files */
	storage?: Storage<MemoryUploadFile>;
	/** Maximum file size in bytes */
	maxFileSize?: number;
	/** Temporary directory for capacitor storage */
	tmpDir?: string;
}

/**
 * Sets a value in an object using a dot-notation path
 * @param obj - Target object
 * @param path - Dot-notation path (e.g., 'user.profile.avatar')
 * @param value - Value to set
 */
function setByPath(
	obj: Record<string, unknown>,
	path: string,
	value: unknown,
): void {
	const segments = path.split('.');
	if (segments.length === 0) {
		return;
	}
	let current = obj;

	for (let i = 0; i < segments.length - 1; i++) {
		const segment = segments[i];
		if (!segment) {
			continue;
		}
		if (!current[segment] || typeof current[segment] !== 'object') {
			current[segment] = {};
		}
		current = current[segment] as Record<string, unknown>;
	}

	const leaf = segments[segments.length - 1];
	if (leaf) {
		current[leaf] = value;
	}
}

/**
 * Processes a GraphQL multipart request with file uploads
 * @param req - Request
 * @param options - Processing options
 * @returns Processed operations with Upload promises
 */
export async function processRequest(
	req: ElysiaRequest,
	options?: ProcessRequestOptions,
): Promise<Record<string, unknown>> {
	const body = (req.body ?? {}) as Record<string, unknown>;

	const operations = JSON.parse(body.operations as string) as Record<
		string,
		unknown
	>;
	const fileMap = new Map(
		Object.entries(JSON.parse(body.map as string) as Record<string, string[]>),
	);

	// Determine storage strategy
	// Default to CapacitorStorage for GraphQL uploads (supports createReadStream)
	const storage =
		options?.storage ??
		new CapacitorStorage({
			maxSize: options?.maxFileSize,
			tmpDir: options?.tmpDir,
		});

	// Process each file upload
	for (const [fieldName, value] of Object.entries(body)) {
		if (fieldName === 'operations' || fieldName === 'map') continue;
		if (!(value instanceof File)) continue;

		const fileKeys = fileMap.get(fieldName);
		if (!fileKeys?.length) continue;

		// Extract the actual field name from the GraphQL path
		// e.g., "variables.file" -> "file", "variables.files.0" -> "files"
		const firstPath = fileKeys[0];
		if (!firstPath) continue;
		const pathParts = firstPath.split('.');
		let actualFieldName = pathParts[pathParts.length - 1];
		if (!actualFieldName) continue;

		// If the last part is a number (array index), get the parent key
		if (/^\d+$/.test(actualFieldName) && pathParts.length > 1) {
			actualFieldName = pathParts[pathParts.length - 2];
			if (!actualFieldName) continue;
		}

		// Create upload promise
		const upload = new Upload();

		// Handle file in background
		storage
			.handleFile(value, req, actualFieldName)
			.then((file) => {
				upload.resolve(file);
			})
			.catch((error) => {
				upload.reject(error);
			});

		// Map upload to all specified paths in operations
		for (const fileKey of fileKeys) {
			setByPath(operations, fileKey, upload);
		}
	}

	return operations;
}
