import { describe, expect, test } from 'bun:test';
import { Readable } from 'node:stream';
import { node } from '@elysia/node';
import { Controller, Get, Module, StreamableFile } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';

import { ElysiaAdapter } from '../src/adapters';

describe('ElysiaAdapter', () => {
	test('forwards options to the Elysia constructor', () => {
		const adapter = new ElysiaAdapter({
			aot: true,
			strictPath: true,
			name: 'test-app',
		});

		expect(adapter.getInstance().config.aot).toBe(true);
		expect(adapter.getInstance().config.strictPath).toBe(true);
		expect(adapter.getInstance().config.name).toBe('test-app');
	});

	test('accepts Elysia official Node adapter configuration', async () => {
		const adapter = new ElysiaAdapter({ adapter: node() });
		adapter.initHttpServer({} as never);
		adapter.get('/node-runtime', (_req, res) => res.send('ok'));

		const response = await adapter
			.getInstance()
			.handle(new Request('http://localhost/node-runtime'));

		expect(await response.text()).toBe('ok');
	});

	test('stops the server created by the Node adapter', async () => {
		const adapter = new ElysiaAdapter({ adapter: node() });
		adapter.initHttpServer({} as never);

		await new Promise<void>((resolve) => {
			adapter.listen(0, resolve);
		});

		await adapter.close();
	});

	test('dispatches middleware, params, query and json body', async () => {
		const adapter = new ElysiaAdapter();
		adapter.initHttpServer({} as never);
		adapter.registerParserMiddleware();

		adapter.use('/users/:id', async (_req, res, next) => {
			res.header('x-middleware', 'hit');
			await next?.();
		});

		adapter.post('/users/:id', async (req, res) => {
			res.status(201).json({
				id: req.params?.id,
				query: req.query,
				body: req.body,
			});
		});

		const response = await adapter.getInstance().handle(
			new Request('http://localhost/users/42?mode=full', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ hello: 'world' }),
			}),
		);

		expect(response.status).toBe(201);
		expect(response.headers.get('x-middleware')).toBe('hit');
		expect(await response.json()).toEqual({
			id: '42',
			query: { mode: 'full' },
			body: { hello: 'world' },
		});
	});

	test('applies path middleware to nested routes', async () => {
		const adapter = new ElysiaAdapter();
		adapter.initHttpServer({} as never);
		adapter.use('/users', async (_req, res, next) => {
			res.header('x-users-middleware', 'hit');
			await next?.();
		});
		adapter.get('/users/42', (_req, res) => res.send('ok'));

		const response = await adapter
			.getInstance()
			.handle(new Request('http://localhost/users/42'));

		expect(response.headers.get('x-users-middleware')).toBe('hit');
	});

	test('waits for downstream async handlers when middleware calls next synchronously', async () => {
		const adapter = new ElysiaAdapter();
		adapter.initHttpServer({} as never);
		adapter.use('/slow', (_req, _res, next) => {
			next?.();
		});
		adapter.get('/slow', async (_req, res) => {
			await new Promise((resolve) => setTimeout(resolve, 10));
			res.send('complete');
		});

		const response = await adapter
			.getInstance()
			.handle(new Request('http://localhost/slow'));

		expect(await response.text()).toBe('complete');
	});

	test('exposes Nest-compatible relative request URLs', async () => {
		const adapter = new ElysiaAdapter();
		adapter.initHttpServer({} as never);
		let requestUrl: string | undefined;
		adapter.get('/users/:id', (req, res) => {
			requestUrl = adapter.getRequestUrl(req);
			res.send('ok');
		});

		await adapter
			.getInstance()
			.handle(new Request('http://localhost/users/42?mode=full'));

		expect(requestUrl).toBe('/users/42?mode=full');
	});

	test('uses custom not found handler', async () => {
		const adapter = new ElysiaAdapter();
		adapter.initHttpServer({} as never);
		adapter.setNotFoundHandler((_req, res) => {
			res.status(404).send('custom-not-found');
		});

		const response = await adapter
			.getInstance()
			.handle(new Request('http://localhost/missing'));

		expect(response.status).toBe(404);
		expect(await response.text()).toBe('custom-not-found');
	});

	test('uses the official CORS plugin for preflight and rejected origins', async () => {
		const adapter = new ElysiaAdapter();
		adapter.initHttpServer({} as never);
		adapter.enableCors({
			origin: ['https://allowed.example'],
			methods: ['GET', 'POST'],
			allowedHeaders: ['content-type'],
			credentials: true,
		});
		adapter.get('/cors', (_req, res) => res.send('ok'));

		const preflight = await adapter.getInstance().handle(
			new Request('http://localhost/cors', {
				method: 'OPTIONS',
				headers: {
					origin: 'https://allowed.example',
					'access-control-request-method': 'POST',
				},
			}),
		);
		const rejected = await adapter.getInstance().handle(
			new Request('http://localhost/cors', {
				headers: { origin: 'https://rejected.example' },
			}),
		);

		expect(preflight.status).toBe(204);
		expect(preflight.headers.get('access-control-allow-origin')).toBe(
			'https://allowed.example',
		);
		expect(rejected.headers.get('access-control-allow-origin')).toBeNull();
	});

	test('captures raw bodies and rejects malformed JSON', async () => {
		const adapter = new ElysiaAdapter();
		adapter.initHttpServer({} as never);
		adapter.useBodyParser('application/json', true, 32);
		adapter.post('/body', (req, res) =>
			res.json({ rawBody: req.rawBody?.toString(), body: req.body }),
		);
		adapter.setErrorHandler((error, _req, res) => {
			const status =
				typeof error === 'object' && error && 'getStatus' in error
					? (error as { getStatus(): number }).getStatus()
					: 500;
			res.status(status).send('invalid');
		});

		const valid = await adapter.getInstance().handle(
			new Request('http://localhost/body', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: '{"value":true}',
			}),
		);
		const invalid = await adapter.getInstance().handle(
			new Request('http://localhost/body', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: '{',
			}),
		);

		expect(await valid.json()).toEqual({
			rawBody: '{"value":true}',
			body: { value: true },
		});
		expect(invalid.status).toBe(400);
	});

	test('enforces a zero-byte body limit', async () => {
		const adapter = new ElysiaAdapter();
		adapter.initHttpServer({} as never);
		adapter.useBodyParser('application/json', false, 0);
		adapter.post('/body', (_req, res) => res.send('ok'));
		adapter.setErrorHandler((error, _req, res) => {
			res
				.status((error as { getStatus(): number }).getStatus())
				.send('limited');
		});

		const response = await adapter.getInstance().handle(
			new Request('http://localhost/body', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: '{}',
			}),
		);

		expect(response.status).toBe(413);
	});

	test('uses the measured body size when Content-Length is invalid', async () => {
		const adapter = new ElysiaAdapter();
		adapter.initHttpServer({} as never);
		adapter.useBodyParser('application/json', false, 1);
		adapter.post('/body', (_req, res) => res.send('ok'));
		adapter.setErrorHandler((error, _req, res) => {
			res
				.status((error as { getStatus(): number }).getStatus())
				.send('limited');
		});

		const response = await adapter.getInstance().handle(
			new Request('http://localhost/body', {
				method: 'POST',
				headers: {
					'content-type': 'application/json',
					'content-length': 'invalid',
				},
				body: '{}',
			}),
		);

		expect(response.status).toBe(413);
	});

	test('does not parse bodies before a parser is registered', async () => {
		const adapter = new ElysiaAdapter();
		adapter.initHttpServer({} as never);
		adapter.post('/body', (req, res) => res.json({ body: req.body }));

		const response = await adapter.getInstance().handle(
			new Request('http://localhost/body', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: '{"value":true}',
			}),
		);

		expect(await response.json()).toEqual({});
	});

	test('serves static assets and StreamableFile responses', async () => {
		const adapter = new ElysiaAdapter();
		adapter.useStaticAssets({ assets: 'test/fixtures', prefix: '/assets' });
		adapter.initHttpServer({} as never);
		adapter.get(
			'/stream',
			() => new StreamableFile(Readable.from(['streamed'])),
		);
		await adapter.getInstance().modules;

		const staticResponse = await adapter
			.getInstance()
			.handle(new Request('http://localhost/assets/greeting.txt'));
		const streamResponse = await adapter
			.getInstance()
			.handle(new Request('http://localhost/stream'));

		expect(staticResponse.status).toBe(200);
		expect(await staticResponse.text()).toBe('hello from static assets\n');
		expect(await streamResponse.text()).toBe('streamed');
	});

	test('boots a real Nest application and dispatches its controller', async () => {
		class HealthController {
			check() {
				return { status: 'ok' };
			}
		}
		Controller()(HealthController);
		Get('health')(HealthController.prototype, 'check', {
			value: HealthController.prototype.check,
			configurable: true,
			writable: true,
		});

		class TestModule {}
		Module({ controllers: [HealthController] })(TestModule);

		const adapter = new ElysiaAdapter();
		const app = await NestFactory.create(TestModule, adapter, {
			logger: false,
		});
		await app.init();

		const response = await adapter
			.getInstance()
			.handle(new Request('http://localhost/health'));

		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({ status: 'ok' });
		await app.close();
	});
});
