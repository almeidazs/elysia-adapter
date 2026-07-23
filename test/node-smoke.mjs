import { node } from '@elysia/node';

import { ElysiaAdapter } from '../dist/index.js';

const adapter = new ElysiaAdapter({ adapter: node() });
adapter.initHttpServer({});
adapter.post('/health', (request, response) => {
	response.status(201).header('x-runtime', 'node').json({
		body: request.body,
		status: 'ok',
	});
});
adapter.registerParserMiddleware();

await new Promise((resolve, reject) => {
	adapter.listen(0, (error) => (error ? reject(error) : resolve()));
});

try {
	const server = adapter.getNodeServer();
	if (!server) throw new Error('The Node.js HTTP server was not exposed');

	const address = server.address();
	if (!address || typeof address === 'string') {
		throw new Error('The Node.js HTTP server did not bind to a TCP port');
	}

	const response = await fetch(`http://127.0.0.1:${address.port}/health`, {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({ source: 'node' }),
	});

	if (response.status !== 201) {
		throw new Error(`Expected HTTP 201, received ${response.status}`);
	}
	if (response.headers.get('x-runtime') !== 'node') {
		throw new Error('Expected the Node.js response header');
	}

	const body = await response.json();
	if (body.status !== 'ok' || body.body.source !== 'node') {
		throw new Error(`Unexpected response body: ${JSON.stringify(body)}`);
	}
} finally {
	await adapter.close();
}
