import type { ElysiaRequest } from '../../types';

/**
 * Stored multipart file metadata.
 */
export interface StorageFile {
	/** Field name in the multipart form */
	fieldName: string;
	/** Original filename provided by client */
	originalFilename: string;
	/** MIME type of the file */
	mimetype: string;
	/** Encoding type (e.g., '7bit', '8bit', 'binary') */
	encoding: string;
	/** Size of the file in bytes */
	size: number;
	/** Timestamp when file was uploaded (ISO 8601) */
	uploadedAt?: string;
}

/**
 * Storage contract used by multipart interceptors.
 */
// biome-ignore lint/suspicious/noExplicitAny: Storage options are defined by each storage implementation.
export interface Storage<T extends StorageFile = StorageFile, K = any> {
	handleFile: (file: File, req: ElysiaRequest, fieldName: string) => Promise<T>;
	removeFile: (file: T | StorageFile, force?: boolean) => Promise<void> | void;
	options?: K;
}
