import { DiskStorage, MemoryStorage, type Storage } from '../storage';
import type { UploadFilterHandler } from './filter';

/**
 * Limits for multipart parsing and file acceptance.
 */
export interface UploadLimits {
	/** Maximum file size in bytes */
	fileSize?: number;
	/** Maximum number of files for a field */
	files?: number;
	/** Maximum number of fields (for file fields upload) */
	fields?: number;
}

/**
 * Public options supported by the multipart interceptors.
 */
export type UploadOptions = {
	/** Destination directory for disk storage */
	dest?: string;
	/** Storage implementation */
	storage?: Storage;
	/** File filter function */
	filter?: UploadFilterHandler;
	/** Upload limits */
	limits?: UploadLimits;
};

/**
 * Default multipart options applied when no explicit storage is configured.
 */
export const DEFAULT_UPLOAD_OPTIONS: Partial<UploadOptions> = {
	storage: new MemoryStorage(),
};

/**
 * Normalizes multipart options into a fully usable configuration object.
 */
export const transformUploadOptions = (opts?: UploadOptions): UploadOptions => {
	if (opts == null) return DEFAULT_UPLOAD_OPTIONS as UploadOptions;

	if (opts.dest != null) {
		return {
			...opts,
			storage: new DiskStorage({
				dest: opts.dest,
				...opts.storage?.options,
			}),
		};
	}

	return { ...DEFAULT_UPLOAD_OPTIONS, ...opts } as UploadOptions;
};
