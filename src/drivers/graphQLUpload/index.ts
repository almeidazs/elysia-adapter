// Core

// Streams
export * from './fs-capacitor';
export { GraphQLUpload } from './GraphQLUpload';
export type { ProcessRequestOptions } from './processRequest';
export { processRequest } from './processRequest';
// Storage - re-export with GQL prefix to avoid conflicts
export type {
	Storage as GQLStorage,
	StorageFile as GQLStorageFile,
	StorageOptions as GQLStorageOptions,
} from './storage';
export type { CapacitorStorageFile as GQLCapacitorStorageFile } from './storage/capacitor-storage';
export { CapacitorStorage as GQLCapacitorStorage } from './storage/capacitor-storage';
export type { MemoryStorageFile as GQLMemoryStorageFile } from './storage/memory-storage';
export { MemoryStorage as GQLMemoryStorage } from './storage/memory-storage';
export type { MemoryUploadFile, StreamUploadFile } from './Upload';
export { Upload } from './Upload';

// Utils - prefix to avoid conflicts with multer
export {
	formatBytes as gqlFormatBytes,
	getFileExtension as gqlGetFileExtension,
	getUniqueFilename as gqlGetUniqueFilename,
	isAllowedFileType as gqlIsAllowedFileType,
	sanitizeFilename as gqlSanitizeFilename,
	validateFileSize as gqlValidateFileSize,
} from './utils/file';
export type { FileValidatorOptions as GQLFileValidatorOptions } from './utils/validators';
export {
	FileTypes as GQLFileTypes,
	validateFile as gqlValidateFile,
} from './utils/validators';
