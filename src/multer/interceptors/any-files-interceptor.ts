import { handleMultipartAnyFiles } from '../multipart/handlers/any-files';
import { UploadOptions } from '../multipart/options';
import { createInterceptor } from './base-interceptor';

/**
 * Creates a Nest interceptor that accepts any multipart file field.
 */
export function AnyFilesInterceptor(
  localOptions?: UploadOptions,
): ReturnType<typeof createInterceptor> {
  return createInterceptor(
    localOptions ?? {},
    (req, options) => handleMultipartAnyFiles(req, options),
    (req, result) => {
      req.body = result.body;
      req.storageFiles = result.files;
    },
  );
}
