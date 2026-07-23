import type { Server as HttpServer } from 'node:http';
import { Readable } from 'node:stream';
import cors, { type CORSConfig } from '@elysiajs/cors';
import staticPlugin from '@elysiajs/static';
import {
	BadRequestException,
	HttpStatus,
	InternalServerErrorException,
	PayloadTooLargeException,
	RequestMethod,
	StreamableFile,
	VERSION_NEUTRAL,
	type VersioningOptions,
	VersioningType,
} from '@nestjs/common';
import type {
	ErrorHandler,
	NestApplicationOptions,
	RequestHandler,
	VersionValue,
} from '@nestjs/common/interfaces';
import { AbstractHttpAdapter } from '@nestjs/core';
import { Elysia } from 'elysia';
import { pathToRegexp } from 'path-to-regexp';
import type {
	ElysiaAdapterOptions,
	ElysiaCorsOptions,
	ElysiaRequest,
	ElysiaStaticAssetsOptions,
	TypeBodyParser,
} from '../types';
import { ElysiaReply } from '../types';

type Method =
	| 'ALL'
	| 'GET'
	| 'POST'
	| 'PUT'
	| 'DELETE'
	| 'PATCH'
	| 'OPTIONS'
	| 'HEAD'
	| 'SEARCH'
	| 'PROPFIND'
	| 'PROPPATCH'
	| 'MKCOL'
	| 'COPY'
	| 'MOVE'
	| 'LOCK'
	| 'UNLOCK'
	| 'USE';

type LayerHandler = RequestHandler<ElysiaRequest, ElysiaReply>;
type CompiledMatcher = ReturnType<typeof pathToRegexp>;

interface Layer {
	method: Method;
	path: string;
	handler: LayerHandler;
	matcher: CompiledMatcher | null;
}

interface ParserConfig {
	type: TypeBodyParser;
	rawBody?: boolean;
	bodyLimit?: number;
}

interface ElysiaListeningServer {
	raw?: {
		node?: {
			server?: HttpServer;
		};
	};
	stop?: (closeActiveConnections?: boolean) => unknown;
}

const _METHODS = [
	'GET',
	'POST',
	'PUT',
	'DELETE',
	'PATCH',
	'OPTIONS',
	'HEAD',
	'SEARCH',
	'PROPFIND',
	'PROPPATCH',
	'MKCOL',
	'COPY',
	'MOVE',
	'LOCK',
	'UNLOCK',
] as const satisfies readonly Method[];

const addLeadingSlash = (path: string) =>
	path.startsWith('/') ? path : `/${path}`;

const isObject = (value: unknown): value is object =>
	typeof value === 'object' && value !== null;

const isString = (value: unknown): value is string => typeof value === 'string';

const convertLegacyRoute = (route: string): string => {
	const routeWithLeadingSlash = addLeadingSlash(route);
	const normalizedRoute = route.endsWith('/')
		? routeWithLeadingSlash
		: `${routeWithLeadingSlash}/`;

	if (normalizedRoute.endsWith('/(.*)/')) {
		return route.replace('(.*)', '{*path}');
	}
	if (normalizedRoute.endsWith('/*/')) {
		return route.replace('*', '{*path}');
	}
	if (normalizedRoute.endsWith('/+/')) {
		return route.replace('/+', '/*path');
	}

	return route.replaceAll('/*/', (match, offset) =>
		normalizedRoute.includes('/*/') ? `/*path${offset}/` : match,
	);
};

const hasBody = (method: string) =>
	!['GET', 'HEAD'].includes(method.toUpperCase());

const toWebStream = (stream: NodeJS.ReadableStream): ReadableStream => {
	if (stream instanceof Readable) {
		return Readable.toWeb(stream) as unknown as ReadableStream;
	}

	return new ReadableStream({
		async start(controller) {
			for await (const chunk of stream as AsyncIterable<Buffer>) {
				controller.enqueue(chunk);
			}
			controller.close();
		},
	});
};

const isResponseLike = (value: unknown): value is Response =>
	value instanceof Response;

const isReadableNodeStream = (value: unknown): value is NodeJS.ReadableStream =>
	!!value &&
	typeof value === 'object' &&
	typeof (value as NodeJS.ReadableStream).pipe === 'function';

const buildQueryObject = (url: URL): Record<string, unknown> => {
	const query: Record<string, unknown> = {};

	for (const [key, value] of url.searchParams.entries()) {
		const current = query[key];

		if (current === undefined) {
			query[key] = value;
			continue;
		}

		if (Array.isArray(current)) {
			current.push(value);
			continue;
		}

		query[key] = [current, value];
	}

	return query;
};

const formDataToObject = (
	formData: globalThis.FormData,
): Record<string, unknown> => {
	const body: Record<string, unknown> = {};

	for (const [key, value] of formData.entries()) {
		const current = body[key];

		if (current === undefined) {
			body[key] = value;
			continue;
		}

		if (Array.isArray(current)) {
			current.push(value);
			continue;
		}

		body[key] = [current, value];
	}

	return body;
};

/**
 * Nest HTTP adapter backed by Elysia.
 *
 * Pass any `new Elysia(options)` configuration through the constructor.
 * For Node.js runtimes, provide `adapter: node()` in those options.
 */
export class ElysiaAdapter extends AbstractHttpAdapter<
	HttpServer | undefined,
	ElysiaRequest,
	ElysiaReply
> {
	private readonly layers: Layer[] = [];
	private readonly parserConfigs: ParserConfig[] = [];
	private _isParserRegistered = false;
	private errorHandler?: ErrorHandler<ElysiaRequest, ElysiaReply>;
	private notFoundHandler?: RequestHandler<ElysiaRequest, ElysiaReply>;
	private rawBodyEnabled = false;
	private nodeServer?: HttpServer;
	private stopListeningServer?: (closeActiveConnections?: boolean) => unknown;
	private serverReadyCallbacks = new Set<
		(server: HttpServer | undefined) => void
	>();

	protected override readonly instance: Elysia;

	constructor(options: ElysiaAdapterOptions = {}) {
		const app = new Elysia(options);
		super(app as unknown as Elysia);
		this.instance = app as unknown as Elysia;
	}

	get isParserRegistered(): boolean {
		return this._isParserRegistered;
	}

	public onServerReady(callback: (server: HttpServer | undefined) => void) {
		const server = this.getNodeServer();
		if (server) {
			callback(server);
			return () => undefined;
		}

		this.serverReadyCallbacks.add(callback);
		return () => this.serverReadyCallbacks.delete(callback);
	}

	public getNodeServer(): HttpServer | undefined {
		const serverInfo = this.instance.server as
			| ElysiaListeningServer
			| null
			| undefined;

		return this.nodeServer ?? serverInfo?.raw?.node?.server ?? this.httpServer;
	}

	public override normalizePath(path: string): string {
		try {
			const convertedPath = convertLegacyRoute(path);
			pathToRegexp(convertedPath);
			return convertedPath;
		} catch {
			throw new TypeError(`Unsupported route path: "${path}"`);
		}
	}

	private createMatcher(path: string, end = true): CompiledMatcher | null {
		if (!path || path === '/' || path === '*') {
			return null;
		}

		return pathToRegexp(addLeadingSlash(this.normalizePath(path)), { end });
	}

	private registerLayer(method: Method, path: string, handler: LayerHandler) {
		const normalizedPath = path ? this.normalizePath(path) : '/';
		this.layers.push({
			method,
			path: normalizedPath,
			handler,
			matcher: this.createMatcher(normalizedPath, method !== 'USE'),
		});

		this.getOnRouteTriggered()?.(
			method === 'USE'
				? RequestMethod.ALL
				: (RequestMethod[method as keyof typeof RequestMethod] ??
						RequestMethod.ALL),
			normalizedPath,
		);
	}

	private getRouteAndHandler(
		pathOrHandler: string | LayerHandler,
		handler?: LayerHandler,
	): [string, LayerHandler] {
		if (typeof pathOrHandler === 'function') {
			return ['/', pathOrHandler];
		}

		return [pathOrHandler, handler as LayerHandler];
	}

	private extractClientIp(request: Request): string | undefined {
		return (
			request.headers.get('cf-connecting-ip') ??
			request.headers.get('x-forwarded-for') ??
			request.headers.get('x-real-ip') ??
			request.headers.get('forwarded') ??
			request.headers.get('true-client-ip') ??
			request.headers.get('x-client-ip') ??
			request.headers.get('x-cluster-client-ip') ??
			request.headers.get('x-forwarded') ??
			request.headers.get('forwarded-for') ??
			request.headers.get('via') ??
			undefined
		);
	}

	private createRequest(
		request: Request,
		params: Record<string, string>,
		routePath: string,
	): ElysiaRequest {
		const url = new URL(request.url);
		return {
			raw: request,
			url: request.url,
			method: request.method,
			signal: request.signal,
			headers: Object.fromEntries(request.headers.entries()),
			params,
			query: buildQueryObject(url),
			ip: this.extractClientIp(request),
			originalUrl: `${url.pathname}${url.search}`,
			routePath,
			header: (name: string) =>
				request.headers.get(name) ??
				request.headers.get(name.toLowerCase()) ??
				undefined,
			text: () => request.clone().text(),
			json: () => request.clone().json(),
			formData: () =>
				request.clone().formData() as Promise<globalThis.FormData>,
			arrayBuffer: () => request.clone().arrayBuffer(),
			clone: () => request.clone(),
		};
	}

	private ensureBodyLimit(
		request: Request,
		limit?: number,
		actualSize?: number,
	): void {
		if (limit === undefined) {
			return;
		}

		const contentLength = request.headers.get('content-length');
		const declaredSize = contentLength ? Number(contentLength) : undefined;
		const size = Number.isFinite(declaredSize) ? declaredSize : actualSize;
		if (size !== undefined && size > limit) {
			throw new PayloadTooLargeException(
				`Body size exceeded: ${limit} bytes. Size: ${size} bytes. Method: ${request.method}. Path: ${new URL(request.url).pathname}`,
			);
		}
	}

	private getParserConfig(
		contentType: string | null,
	): ParserConfig | undefined {
		if (!contentType) {
			return undefined;
		}

		return this.parserConfigs.find((config) =>
			contentType.startsWith(config.type),
		);
	}

	private async parseRequestBody(req: ElysiaRequest): Promise<void> {
		if (!hasBody(req.method)) {
			return;
		}

		const contentType = req.header('content-type');
		if (!contentType) {
			return;
		}

		const parser = contentType.startsWith('multipart/form-data')
			? this.getParserConfig('application/x-www-form-urlencoded')
			: this.getParserConfig(contentType);
		if (!parser) {
			return;
		}

		if (contentType.startsWith('multipart/form-data')) {
			const rawBody = await req.arrayBuffer();
			this.ensureBodyLimit(req.raw, parser?.bodyLimit, rawBody.byteLength);
			req.body = formDataToObject(await req.formData());
			return;
		}

		if (contentType.startsWith('application/x-www-form-urlencoded')) {
			const rawBody = await req.arrayBuffer();
			this.ensureBodyLimit(req.raw, parser?.bodyLimit, rawBody.byteLength);
			const formData = await req.formData();
			req.body = formDataToObject(formData);
			return;
		}

		if (
			contentType.startsWith('application/json') ||
			contentType.startsWith('text/plain')
		) {
			const buffer = Buffer.from(await req.arrayBuffer());
			this.ensureBodyLimit(req.raw, parser?.bodyLimit, buffer.byteLength);

			if (this.rawBodyEnabled || parser?.rawBody) {
				req.rawBody = buffer;
			}

			if (contentType.startsWith('application/json')) {
				try {
					req.body = buffer.length ? JSON.parse(buffer.toString('utf8')) : {};
				} catch {
					throw new BadRequestException('Invalid JSON request body');
				}
				return;
			}

			req.body = buffer.toString('utf8');
		}
	}

	private matchesLayer(
		layer: Layer,
		method: string,
		path: string,
	): Record<string, string> | null {
		const normalizedMethod = method.toUpperCase();
		const layerMethod = layer.method;

		const methodMatches =
			layerMethod === 'USE' ||
			layerMethod === 'ALL' ||
			layerMethod === normalizedMethod ||
			(normalizedMethod === 'HEAD' && layerMethod === 'GET');

		if (!methodMatches) {
			return null;
		}

		if (!layer.matcher) {
			return {};
		}

		const result = layer.matcher.regexp.exec(path);
		if (!result) {
			return null;
		}

		const params: Record<string, string> = {};

		for (let index = 0; index < layer.matcher.keys.length; index++) {
			const key = layer.matcher.keys[index];
			const value = result[index + 1];

			if (typeof key?.name === 'string' && value !== undefined) {
				params[key.name] = value;
			}
		}

		return params;
	}

	private async dispatch(request: Request): Promise<Response> {
		const pathname = addLeadingSlash(new URL(request.url).pathname);
		const matchingLayers = this.layers
			.map((layer) => {
				const params = this.matchesLayer(layer, request.method, pathname);
				if (params === null) {
					return null;
				}

				return { layer, params };
			})
			.filter(Boolean) as Array<{
			layer: Layer;
			params: Record<string, string>;
		}>;

		const req = this.createRequest(request, {}, pathname);
		const res = new ElysiaReply(req);

		try {
			await this.parseRequestBody(req);
		} catch (error) {
			if (this.errorHandler) {
				await this.errorHandler(error, req, res);
				return this.toResponse(res);
			}
			throw error;
		}

		let index = -1;
		const next = async (): Promise<void> => {
			index++;

			const entry = matchingLayers[index];
			if (entry) {
				req.params = entry.params;
				req.routePath = entry.layer.path;

				let downstream: Promise<void> | undefined;
				const runDownstream = () => (downstream ??= next());

				try {
					const result = await entry.layer.handler(req, res, runDownstream);
					await downstream;

					if (!res.headersSent && result !== undefined) {
						await this.reply(res, result);
					}
				} catch (error) {
					if (this.errorHandler) {
						await this.errorHandler(error, req, res, runDownstream);
						await downstream;
						return;
					}
					throw error;
				}
				return;
			}

			if (this.notFoundHandler) {
				await this.notFoundHandler(req, res);
				if (!res.headersSent) {
					await this.status(res, HttpStatus.NOT_FOUND);
				}
				return;
			}

			await this.reply(res, 'Not Found', HttpStatus.NOT_FOUND);
		};

		await next();
		return this.toResponse(res);
	}

	private toResponse(reply: ElysiaReply): Response {
		const body = reply.body;

		if (isResponseLike(body)) {
			const headers = new Headers(body.headers);

			for (const [key, value] of reply.headers.entries()) {
				if (key === 'set-cookie') {
					headers.append(key, value);
				} else if (!headers.has(key)) {
					headers.set(key, value);
				}
			}

			return new Response(body.body, {
				status: body.status === 200 ? reply.statusCode : body.status,
				headers,
			});
		}

		if (body instanceof StreamableFile) {
			return this.streamableFileToResponse(reply, body);
		}

		const headers = new Headers(reply.headers);
		let responseBody: BodyInit | null = null;

		if (body === undefined || body === null) {
			responseBody = null;
		} else if (
			body instanceof ArrayBuffer ||
			ArrayBuffer.isView(body) ||
			body instanceof Blob ||
			body instanceof FormData ||
			body instanceof URLSearchParams ||
			body instanceof ReadableStream
		) {
			responseBody = body as BodyInit;
		} else if (isReadableNodeStream(body)) {
			responseBody = toWebStream(body);
		} else if (typeof body === 'string') {
			if (!headers.has('content-type')) {
				headers.set('content-type', 'text/plain; charset=utf-8');
			}
			responseBody = body;
		} else if (isObject(body)) {
			if (!headers.has('content-type')) {
				headers.set('content-type', 'application/json; charset=utf-8');
			}
			responseBody = JSON.stringify(body);
		} else {
			responseBody = String(body);
		}

		return new Response(responseBody, {
			status: reply.statusCode,
			headers,
		});
	}

	private streamableFileToResponse(
		reply: ElysiaReply,
		file: StreamableFile,
	): Response {
		const headers = new Headers(reply.headers);
		const streamHeaders = file.getHeaders();

		if (!headers.has('content-type') && streamHeaders.type) {
			headers.set('content-type', streamHeaders.type);
		}
		if (!headers.has('content-disposition') && streamHeaders.disposition) {
			headers.set(
				'content-disposition',
				Array.isArray(streamHeaders.disposition)
					? streamHeaders.disposition.join(',')
					: streamHeaders.disposition,
			);
		}
		if (!headers.has('content-length') && streamHeaders.length) {
			headers.set('content-length', String(streamHeaders.length));
		}

		return new Response(toWebStream(file.getStream()), {
			status: reply.statusCode,
			headers,
		});
	}

	public override use(
		pathOrHandler: string | LayerHandler,
		handler?: LayerHandler,
	) {
		const [path, routeHandler] = this.getRouteAndHandler(
			pathOrHandler,
			handler,
		);
		this.registerLayer('USE', path, routeHandler);
		return this;
	}

	public override get(
		pathOrHandler: string | LayerHandler,
		handler?: LayerHandler,
	) {
		const [path, routeHandler] = this.getRouteAndHandler(
			pathOrHandler,
			handler,
		);
		this.registerLayer('GET', path, routeHandler);
		return this;
	}

	public override post(
		pathOrHandler: string | LayerHandler,
		handler?: LayerHandler,
	) {
		const [path, routeHandler] = this.getRouteAndHandler(
			pathOrHandler,
			handler,
		);
		this.registerLayer('POST', path, routeHandler);
		return this;
	}

	public override head(
		pathOrHandler: string | LayerHandler,
		handler?: LayerHandler,
	) {
		const [path, routeHandler] = this.getRouteAndHandler(
			pathOrHandler,
			handler,
		);
		this.registerLayer('HEAD', path, routeHandler);
		return this;
	}

	public override put(
		pathOrHandler: string | LayerHandler,
		handler?: LayerHandler,
	) {
		const [path, routeHandler] = this.getRouteAndHandler(
			pathOrHandler,
			handler,
		);
		this.registerLayer('PUT', path, routeHandler);
		return this;
	}

	public override delete(
		pathOrHandler: string | LayerHandler,
		handler?: LayerHandler,
	) {
		const [path, routeHandler] = this.getRouteAndHandler(
			pathOrHandler,
			handler,
		);
		this.registerLayer('DELETE', path, routeHandler);
		return this;
	}

	public override patch(
		pathOrHandler: string | LayerHandler,
		handler?: LayerHandler,
	) {
		const [path, routeHandler] = this.getRouteAndHandler(
			pathOrHandler,
			handler,
		);
		this.registerLayer('PATCH', path, routeHandler);
		return this;
	}

	public override options(
		pathOrHandler: string | LayerHandler,
		handler?: LayerHandler,
	) {
		const [path, routeHandler] = this.getRouteAndHandler(
			pathOrHandler,
			handler,
		);
		this.registerLayer('OPTIONS', path, routeHandler);
		return this;
	}

	public override all(
		pathOrHandler: string | LayerHandler,
		handler?: LayerHandler,
	) {
		const [path, routeHandler] = this.getRouteAndHandler(
			pathOrHandler,
			handler,
		);
		this.registerLayer('ALL', path, routeHandler);
		return this;
	}

	public override search(
		pathOrHandler: string | LayerHandler,
		handler?: LayerHandler,
	) {
		const [path, routeHandler] = this.getRouteAndHandler(
			pathOrHandler,
			handler,
		);
		this.registerLayer('SEARCH', path, routeHandler);
		return this;
	}

	public override propfind(
		pathOrHandler: string | LayerHandler,
		handler?: LayerHandler,
	) {
		const [path, routeHandler] = this.getRouteAndHandler(
			pathOrHandler,
			handler,
		);
		this.registerLayer('PROPFIND', path, routeHandler);
		return this;
	}

	public override proppatch(
		pathOrHandler: string | LayerHandler,
		handler?: LayerHandler,
	) {
		const [path, routeHandler] = this.getRouteAndHandler(
			pathOrHandler,
			handler,
		);
		this.registerLayer('PROPPATCH', path, routeHandler);
		return this;
	}

	public override mkcol(
		pathOrHandler: string | LayerHandler,
		handler?: LayerHandler,
	) {
		const [path, routeHandler] = this.getRouteAndHandler(
			pathOrHandler,
			handler,
		);
		this.registerLayer('MKCOL', path, routeHandler);
		return this;
	}

	public override copy(
		pathOrHandler: string | LayerHandler,
		handler?: LayerHandler,
	) {
		const [path, routeHandler] = this.getRouteAndHandler(
			pathOrHandler,
			handler,
		);
		this.registerLayer('COPY', path, routeHandler);
		return this;
	}

	public override move(
		pathOrHandler: string | LayerHandler,
		handler?: LayerHandler,
	) {
		const [path, routeHandler] = this.getRouteAndHandler(
			pathOrHandler,
			handler,
		);
		this.registerLayer('MOVE', path, routeHandler);
		return this;
	}

	public override lock(
		pathOrHandler: string | LayerHandler,
		handler?: LayerHandler,
	) {
		const [path, routeHandler] = this.getRouteAndHandler(
			pathOrHandler,
			handler,
		);
		this.registerLayer('LOCK', path, routeHandler);
		return this;
	}

	public override unlock(
		pathOrHandler: string | LayerHandler,
		handler?: LayerHandler,
	) {
		const [path, routeHandler] = this.getRouteAndHandler(
			pathOrHandler,
			handler,
		);
		this.registerLayer('UNLOCK', path, routeHandler);
		return this;
	}

	public async reply(
		response: ElysiaReply,
		body: unknown,
		statusCode?: number,
	) {
		if (statusCode !== undefined) {
			response.status(statusCode);
		}

		response.send(body);
		return response;
	}

	public status(response: ElysiaReply, statusCode: number) {
		return response.status(statusCode);
	}

	public end(response: ElysiaReply, message?: string) {
		return response.end(message);
	}

	public render(_response: ElysiaReply, _view: string, _options: unknown) {
		throw new Error('Method not implemented.');
	}

	public redirect(response: ElysiaReply, statusCode: number, url: string) {
		return response.redirect(statusCode, url);
	}

	public setErrorHandler(handler: ErrorHandler<ElysiaRequest, ElysiaReply>) {
		this.errorHandler = handler;
	}

	public setNotFoundHandler(
		handler: RequestHandler<ElysiaRequest, ElysiaReply>,
	) {
		this.notFoundHandler = handler;
	}

	public useStaticAssets(
		prefixOrOptions: string | ElysiaStaticAssetsOptions,
		maybeOptions: ElysiaStaticAssetsOptions = {},
	) {
		const options =
			typeof prefixOrOptions === 'string'
				? { ...maybeOptions, prefix: prefixOrOptions }
				: prefixOrOptions;

		this.instance.use(staticPlugin(options as never));
		return this;
	}

	public setViewEngine() {
		throw new Error('Method not implemented.');
	}

	public isHeadersSent(response: ElysiaReply) {
		return response.finalized;
	}

	public getHeader(response: ElysiaReply, name: string) {
		return response.headers.get(name) ?? undefined;
	}

	public setHeader(response: ElysiaReply, name: string, value: string) {
		response.headers.set(name, value);
	}

	public appendHeader(response: ElysiaReply, name: string, value: string) {
		response.headers.append(name, value);
	}

	public getRequestHostname(request: ElysiaRequest): string {
		return new URL(request.url).hostname;
	}

	public getRequestMethod(request: ElysiaRequest): string {
		return request.method;
	}

	public getRequestUrl(request: ElysiaRequest): string {
		return (
			request.originalUrl ??
			`${new URL(request.url).pathname}${new URL(request.url).search}`
		);
	}

	public enableCors(options: ElysiaCorsOptions = {}) {
		this.instance.use(cors(options as CORSConfig));
		return this;
	}

	public initHttpServer(_options: NestApplicationOptions) {
		this.instance.mount((request) => this.dispatch(request));
	}

	public async close(): Promise<void> {
		if (this.stopListeningServer) {
			await this.stopListeningServer(true);
			this.stopListeningServer = undefined;
			this.nodeServer = undefined;
			this.httpServer = undefined;
			return;
		}

		if (this.instance.server) {
			await this.instance.stop(true);
		}
	}

	public getType(): string {
		return 'elysia';
	}

	public registerParserMiddleware(_prefix?: string, rawBody?: boolean) {
		if (this._isParserRegistered) {
			return;
		}

		this.useBodyParser('application/x-www-form-urlencoded', rawBody);
		this.useBodyParser('application/json', rawBody);
		this.useBodyParser('text/plain', rawBody);
		this._isParserRegistered = true;
	}

	public useBodyParser(
		type: TypeBodyParser,
		rawBody?: boolean,
		bodyLimit?: number,
	) {
		this.parserConfigs.push({
			type,
			rawBody,
			bodyLimit,
		});
		this.rawBodyEnabled ||= !!rawBody;
		this._isParserRegistered = true;
		return this;
	}

	public async createMiddlewareFactory(requestMethod: RequestMethod) {
		return (
			path: string,
			// biome-ignore lint/complexity/noBannedTypes: Required by Nest's AbstractHttpAdapter contract.
			callback: Function,
		) => {
			const methodMap: Record<number, Method> = {
				[RequestMethod.ALL]: 'ALL',
				[RequestMethod.GET]: 'GET',
				[RequestMethod.POST]: 'POST',
				[RequestMethod.PUT]: 'PUT',
				[RequestMethod.DELETE]: 'DELETE',
				[RequestMethod.PATCH]: 'PATCH',
				[RequestMethod.OPTIONS]: 'OPTIONS',
				[RequestMethod.HEAD]: 'HEAD',
				[RequestMethod.SEARCH]: 'SEARCH',
				[RequestMethod.PROPFIND]: 'PROPFIND',
				[RequestMethod.PROPPATCH]: 'PROPPATCH',
				[RequestMethod.MKCOL]: 'MKCOL',
				[RequestMethod.COPY]: 'COPY',
				[RequestMethod.MOVE]: 'MOVE',
				[RequestMethod.LOCK]: 'LOCK',
				[RequestMethod.UNLOCK]: 'UNLOCK',
			};

			const method = methodMap[requestMethod] ?? 'ALL';
			this.registerLayer(method, path, callback as LayerHandler);
		};
	}

	public applyVersionFilter(
		// biome-ignore lint/complexity/noBannedTypes: Required by Nest's AbstractHttpAdapter contract.
		handler: Function,
		version: VersionValue,
		versioningOptions: VersioningOptions,
	) {
		const callNextHandler = (
			_req: ElysiaRequest,
			_res: ElysiaReply,
			next?: () => void,
		) => {
			if (!next) {
				throw new InternalServerErrorException(
					'HTTP adapter does not support filtering on version',
				);
			}

			return next();
		};

		if (
			version === VERSION_NEUTRAL ||
			versioningOptions.type === VersioningType.URI
		) {
			return (req: ElysiaRequest, res: ElysiaReply, next?: () => void) =>
				handler(req, res, next);
		}

		if (versioningOptions.type === VersioningType.CUSTOM) {
			return (req: ElysiaRequest, res: ElysiaReply, next?: () => void) => {
				const extractedVersion = versioningOptions.extractor(req);

				if (Array.isArray(version)) {
					if (
						Array.isArray(extractedVersion) &&
						version.some(
							(value) =>
								typeof value === 'string' &&
								extractedVersion.some((item) => item === value),
						)
					) {
						return handler(req, res, next);
					}

					if (
						isString(extractedVersion) &&
						version.includes(extractedVersion)
					) {
						return handler(req, res, next);
					}
				} else if (isString(version)) {
					if (
						Array.isArray(extractedVersion) &&
						extractedVersion.includes(version)
					) {
						return handler(req, res, next);
					}

					if (isString(extractedVersion) && extractedVersion === version) {
						return handler(req, res, next);
					}
				}

				return callNextHandler(req, res, next);
			};
		}

		if (versioningOptions.type === VersioningType.MEDIA_TYPE) {
			return (req: ElysiaRequest, res: ElysiaReply, next?: () => void) => {
				const acceptHeaderValue = req.headers?.Accept ?? req.headers?.accept;
				const acceptHeaderVersionParameter = acceptHeaderValue
					? acceptHeaderValue.split(';')[1]
					: undefined;

				if (acceptHeaderVersionParameter === undefined) {
					if (Array.isArray(version) && version.includes(VERSION_NEUTRAL)) {
						return handler(req, res, next);
					}
				} else {
					const headerVersion = acceptHeaderVersionParameter.split(
						versioningOptions.key,
					)[1];

					if (
						headerVersion !== undefined &&
						Array.isArray(version) &&
						version.includes(headerVersion)
					) {
						return handler(req, res, next);
					}

					if (isString(version) && version === headerVersion) {
						return handler(req, res, next);
					}
				}

				return callNextHandler(req, res, next);
			};
		}

		if (versioningOptions.type === VersioningType.HEADER) {
			return (req: ElysiaRequest, res: ElysiaReply, next?: () => void) => {
				const customHeaderVersion =
					req.headers?.[versioningOptions.header] ??
					req.headers?.[versioningOptions.header.toLowerCase()];

				if (customHeaderVersion === undefined) {
					if (Array.isArray(version) && version.includes(VERSION_NEUTRAL)) {
						return handler(req, res, next);
					}
				} else {
					if (Array.isArray(version) && version.includes(customHeaderVersion)) {
						return handler(req, res, next);
					}

					if (isString(version) && version === customHeaderVersion) {
						return handler(req, res, next);
					}
				}

				return callNextHandler(req, res, next);
			};
		}

		throw new Error('Unsupported versioning options');
	}

	public override listen(
		port: string | number,
		callback?: () => void,
	): HttpServer | undefined;
	public override listen(
		port: string | number,
		hostname: string,
		callback?: () => void,
	): HttpServer | undefined;
	public override listen(
		port: string | number,
		hostnameOrCallback?: string | (() => void),
		callback?: () => void,
	): HttpServer | undefined {
		const host =
			typeof hostnameOrCallback === 'string' ? hostnameOrCallback : undefined;
		const onListen =
			typeof hostnameOrCallback === 'function' ? hostnameOrCallback : callback;

		this.instance.listen(
			{
				port: typeof port === 'string' ? Number(port) : port,
				hostname: host,
			},
			(serverInfo?: ElysiaListeningServer) => {
				this.stopListeningServer = serverInfo?.stop?.bind(serverInfo);
				this.nodeServer = serverInfo?.raw?.node?.server;
				const server = this.getNodeServer();
				this.httpServer = server;
				for (const ready of this.serverReadyCallbacks) {
					ready(server);
				}
				this.serverReadyCallbacks.clear();
				onListen?.();
			},
		);

		return this.getNodeServer();
	}
}
