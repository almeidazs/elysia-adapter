import {
	type CallHandler,
	type ExecutionContext,
	mixin,
	type NestInterceptor,
	type Type,
} from '@nestjs/common';
import { finalize } from 'rxjs';
import type { Observable } from 'rxjs/internal/Observable';

import type { FileProcessResult } from '../multipart/handlers/base-handler';
import {
	transformUploadOptions,
	type UploadOptions,
} from '../multipart/options';
import { getMultipartRequest } from '../multipart/request';

/**
 * Shared handler signature used by multipart interceptors.
 */
export type HandlerFunction<T extends FileProcessResult> = (
	req: ReturnType<typeof getMultipartRequest>,
	options: UploadOptions,
) => Promise<T>;

/**
 * Creates a Nest multipart interceptor around a low-level request handler.
 */
export function createInterceptor<T extends FileProcessResult>(
	rawOptions: UploadOptions,
	handlerFn: HandlerFunction<T>,
	resultProcessor: (
		req: ReturnType<typeof getMultipartRequest>,
		result: T,
	) => void,
): Type<NestInterceptor> {
	class MixinInterceptor implements NestInterceptor {
		private readonly options: UploadOptions;

		constructor() {
			this.options = transformUploadOptions(rawOptions);
		}

		async intercept(
			context: ExecutionContext,
			next: CallHandler,
		): Promise<Observable<unknown>> {
			const ctx = context.switchToHttp();
			const req = getMultipartRequest(ctx);

			if (!req.header('content-type')?.startsWith('multipart/form-data')) {
				return next.handle();
			}

			const result = await handlerFn(req, this.options);
			resultProcessor(req, result);

			return next.handle().pipe(finalize(result.remove));
		}
	}

	return mixin(MixinInterceptor);
}
