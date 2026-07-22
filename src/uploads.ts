export * from './multer';
export * from './drivers/graphQLUpload';

import { processRequest } from './drivers/graphQLUpload';
import type { ElysiaRequest } from './types';

/** Opt-in parser for GraphQL multipart requests used by `ElysiaGraphQLDriver`. */
export const graphQLUploadParser = (request: ElysiaRequest) =>
  processRequest(request);
