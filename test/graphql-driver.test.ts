import { describe, expect, test } from 'bun:test';
import { buildSchema } from 'graphql';

import { ElysiaAdapter } from '../src/adapters';
import { ElysiaGraphQLDriver } from '../src/graphql';
import type { ElysiaRequest } from '../src/types';
import { processRequest } from '../src/uploads';

describe('ElysiaGraphQLDriver', () => {
	test('serves graphql over HTTP', async () => {
		const adapter = new ElysiaAdapter();
		adapter.initHttpServer({} as never);

		const driver = new ElysiaGraphQLDriver();
		(driver as never).httpAdapterHost = { httpAdapter: adapter };

		await driver.start({
			path: '/graphql',
			typeDefs: 'type Query { hello: String! }',
			resolvers: {
				Query: {
					hello: () => 'world',
				},
			},
		});

		const response = await adapter.getInstance().handle(
			new Request('http://localhost/graphql', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ query: '{ hello }' }),
			}),
		);

		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({
			data: { hello: 'world' },
		});
	});

	test('accepts object-based GraphQL context values', async () => {
		const adapter = new ElysiaAdapter();
		adapter.initHttpServer({} as never);

		const driver = new ElysiaGraphQLDriver();
		(driver as never).httpAdapterHost = { httpAdapter: adapter };

		await driver.start({
			path: '/graphql',
			typeDefs: 'type Query { scope: String! }',
			resolvers: {
				Query: {
					scope: (_root: unknown, _args: unknown, context: { scope: string }) =>
						context.scope,
				},
			},
			context: { scope: 'elysia' },
		});

		const response = await adapter.getInstance().handle(
			new Request('http://localhost/graphql', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ query: '{ scope }' }),
			}),
		);

		expect(await response.json()).toEqual({ data: { scope: 'elysia' } });
	});

	test('acknowledges graphql-ws connections and closes with the application', async () => {
		const adapter = new ElysiaAdapter();
		adapter.initHttpServer({} as never);

		const driver = new ElysiaGraphQLDriver();
		(driver as never).httpAdapterHost = { httpAdapter: adapter };
		await driver.start({
			path: '/graphql',
			schema: buildSchema('type Query { health: String! }'),
			subscriptions: { 'graphql-ws': true },
		} as never);

		adapter.listen(0);
		const server = adapter.getInstance().server as { port: number };
		let resolveClosed!: () => void;
		const closed = new Promise<void>((resolve) => {
			resolveClosed = resolve;
		});
		const message = await new Promise<string>((resolve, reject) => {
			const socket = new WebSocket(
				`ws://localhost:${server.port}/graphql`,
				'graphql-transport-ws',
			);
			const timeout = setTimeout(
				() => reject(new Error('WebSocket timeout')),
				2_000,
			);
			socket.addEventListener('open', () => {
				socket.send(JSON.stringify({ type: 'connection_init' }));
			});
			socket.addEventListener('message', (event) => {
				clearTimeout(timeout);
				resolve(String(event.data));
			});
			socket.addEventListener('close', () => resolveClosed());
			socket.addEventListener('error', () => {
				clearTimeout(timeout);
				reject(new Error('WebSocket connection failed'));
			});
		});

		expect(JSON.parse(message)).toEqual({ type: 'connection_ack' });
		await driver.stop();
		await adapter.close();
		await closed;
	});

	test('processes optional graphql multipart uploads', async () => {
		const upload = new File(['file-content'], 'hello.txt', {
			type: 'text/plain',
		});

		const request = {
			raw: new Request('http://localhost/graphql'),
			url: 'http://localhost/graphql',
			method: 'POST',
			signal: new AbortController().signal,
			headers: { 'content-type': 'multipart/form-data' },
			body: {
				operations: JSON.stringify({
					query: 'mutation ($file: Upload!) { upload(file: $file) }',
					variables: { file: null },
				}),
				map: JSON.stringify({ '0': ['variables.file'] }),
				'0': upload,
			},
			header(name: string) {
				return this.headers[name];
			},
			async text() {
				return '';
			},
			async json() {
				return {};
			},
			async formData() {
				return new FormData();
			},
			async arrayBuffer() {
				return new ArrayBuffer(0);
			},
			clone() {
				return this.raw.clone();
			},
		} satisfies ElysiaRequest;

		const result = await processRequest(request);
		const file = await (
			result.variables as { file: { promise: Promise<unknown> } }
		).file.promise;

		expect((file as { originalFilename: string }).originalFilename).toBe(
			'hello.txt',
		);
	});
});
