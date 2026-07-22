// Core
export { Upload } from './Upload';
export type { MemoryUploadFile, StreamUploadFile } from './Upload';
export { GraphQLUpload } from './GraphQLUpload';
export { processRequest } from './processRequest';
export type { ProcessRequestOptions } from './processRequest';

// Streams
export * from './fs-capacitor';

// Storage - re-export with GQL prefix to avoid conflicts
export type {
  StorageFile as GQLStorageFile,
  Storage as GQLStorage,
  StorageOptions as GQLStorageOptions,
} from './storage';
export {
  CapacitorStorage as GQLCapacitorStorage,
} from './storage/capacitor-storage';
export type { CapacitorStorageFile as GQLCapacitorStorageFile } from './storage/capacitor-storage';
export {
  MemoryStorage as GQLMemoryStorage,
} from './storage/memory-storage';
export type { MemoryStorageFile as GQLMemoryStorageFile } from './storage/memory-storage';

// Utils - prefix to avoid conflicts with multer
export {
  formatBytes as gqlFormatBytes,
  validateFileSize as gqlValidateFileSize,
  getFileExtension as gqlGetFileExtension,
  isAllowedFileType as gqlIsAllowedFileType,
  sanitizeFilename as gqlSanitizeFilename,
  getUniqueFilename as gqlGetUniqueFilename,
} from './utils/file';

export {
  FileTypes as GQLFileTypes,
  validateFile as gqlValidateFile,
} from './utils/validators';
export type { FileValidatorOptions as GQLFileValidatorOptions } from './utils/validators';
