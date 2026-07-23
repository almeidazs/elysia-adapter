import type { Elysia } from 'elysia';
import type { GraphQLSchema } from 'graphql';
import {
	GRAPHQL_TRANSPORT_WS_PROTOCOL,
	makeServer,
	type ServerOptions,
} from 'graphql-ws';

type SocketLike = {
	close(code?: number, reason?: string): unknown;
	send(data: string): unknown;
	sendText?(data: string): unknown;
};

type Client = {
	close: (code?: number, reason?: string) => Promise<void>;
	onMessage: (message: string) => Promise<void>;
};

export type ElysiaGraphQLWsOptions = Omit<
	ServerOptions,
	'schema' | 'context'
> & {
	path?: string;
	context?: ServerOptions['context'];
};

/**
 * Bridges Elysia WebSocket hooks to the `graphql-ws` protocol server.
 *
 * It deliberately owns no HTTP server, making it work with both Bun and
 * Elysia's Node adapter.
 */
export class ElysiaGraphQLWsSubscriptionServer {
	private readonly clients = new Map<SocketLike, Client>();

	constructor(
		app: Elysia,
		schema: GraphQLSchema,
		options: ElysiaGraphQLWsOptions = {},
	) {
		const protocolServer = makeServer({
			...options,
			schema,
			context: options.context,
		});
		const path = options.path ?? '/graphql';

		app.ws(path, {
			open: (ws: unknown) => {
				const socket = this.getSocket(ws);
				const client: Client = {
					onMessage: async () => {
						throw new Error(
							'Received a GraphQL WebSocket message before setup',
						);
					},
					close: async () => undefined,
				};

				client.close = protocolServer.opened(
					{
						protocol: this.getProtocol(ws),
						send: (message) => this.send(socket, message),
						close: (code, reason) => {
							void socket.close(code, reason);
						},
						onMessage: (handler) => {
							client.onMessage = handler;
						},
					},
					{
						socket,
						request: this.getRequest(ws),
					},
				);

				this.clients.set(socket, client);
			},
			message: async (ws: unknown, message: unknown) => {
				const client = this.clients.get(this.getSocket(ws));
				const payload =
					typeof message === 'string' ? message : JSON.stringify(message);
				await client?.onMessage(payload);
			},
			close: async (ws: unknown, code?: number, reason?: string) => {
				const socket = this.getSocket(ws);
				const client = this.clients.get(socket);
				this.clients.delete(socket);
				await client?.close(code, reason);
			},
		} as never);
	}

	/** Releases graphql-ws operations before the adapter closes its sockets. */
	async stop(): Promise<void> {
		const clients = [...this.clients.values()];
		this.clients.clear();

		await Promise.all(
			clients.map(async (client) => {
				await client.close(1001, 'Server shutting down');
			}),
		);
	}

	private getSocket(ws: unknown): SocketLike {
		const candidate = ws as { raw?: SocketLike } & SocketLike;
		return candidate.raw ?? candidate;
	}

	private getProtocol(ws: unknown): string {
		const socket = this.getSocket(ws) as SocketLike & { protocol?: string };
		return socket.protocol || GRAPHQL_TRANSPORT_WS_PROTOCOL;
	}

	private getRequest(ws: unknown): Request | undefined {
		return (ws as { data?: { request?: Request } }).data?.request;
	}

	private send(socket: SocketLike, message: string): void {
		if (socket.sendText) {
			socket.sendText(message);
			return;
		}

		socket.send(message);
	}
}
