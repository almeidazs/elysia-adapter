export * from './drivers/graphQLUpload';
export * from './multer';

import { processRequest } from './drivers/graphQLUpload';
import type { ElysiaRequest } from './types';

/** Opt-in parser for GraphQL multipart requests used by `ElysiaGraphQLDriver`. */
export const graphQLUploadParser = (request: ElysiaRequest) =>
	processRequest(request);
