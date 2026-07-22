import { ApolloServer, BaseContext, HeaderMap } from '@apollo/server';
import { ApolloDriverConfig } from '@nestjs/apollo';
import { Logger } from '@nestjs/common';
import {
  AbstractGraphQLDriver,
} from '@nestjs/graphql';
import type { GraphQLSchema } from 'graphql';

import { ElysiaAdapter } from '../adapters';
import type { ElysiaRequest, ElysiaReply } from '../types';
import {
  ElysiaGraphQLWsSubscriptionServer,
  type ElysiaGraphQLWsOptions,
} from './graphql-ws';

export type ElysiaGraphQLDriverConfig = ApolloDriverConfig & {
  subscriptions?: {
    'graphql-ws'?: boolean | ElysiaGraphQLWsOptions;
  };
  uploadParser?: (request: ElysiaRequest) => Promise<Record<string, unknown>>;
};

/**
 * Apollo GraphQL driver for Nest applications running on `ElysiaAdapter`.
 */
export class ElysiaGraphQLDriver<
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  T extends Record<string, any> = ApolloDriverConfig,
> extends AbstractGraphQLDriver {
  protected apolloServer!: ApolloServer<BaseContext>;
  private subscriptionServer?: ElysiaGraphQLWsSubscriptionServer;

  /**
   * Returns the underlying Apollo server instance.
   */
  get instance(): ApolloServer<BaseContext> {
    return this.apolloServer;
  }

  /**
   * Starts the Apollo server and registers the GraphQL HTTP endpoint on the adapter.
   */
  async start(options: T): Promise<void> {
    const { httpAdapter } = this.httpAdapterHost;

    if (httpAdapter.getType() !== 'elysia') {
      throw new Error('This driver is only compatible with the Elysia platform');
    }

    await this.registerElysia(options);
    this.registerSubscriptions(options as ElysiaGraphQLDriverConfig);
  }

  protected async registerElysia(
    options: T,
    { preStartHook }: { preStartHook?: () => void } = {},
  ) {
    const { path, typeDefs, resolvers, schema } = options;
    const { httpAdapter } = this.httpAdapterHost;

    preStartHook?.();

    const server = new ApolloServer({
      typeDefs,
      resolvers,
      schema,
      ...options,
      plugins: options.plugins || [],
    });

    await server.start();

    httpAdapter.all(path, async (req: ElysiaRequest, res: ElysiaReply) => {
      const bodyData = await this.parseBody(
        req,
        (options as ElysiaGraphQLDriverConfig).uploadParser,
      );
      const httpGraphQLResponse = await server.executeHTTPGraphQLRequest({
        httpGraphQLRequest: {
          body: bodyData,
          method: req.method,
          headers: this.httpHeadersToMap(req.headers ?? {}),
          search: new URL(req.url).search,
        },
        context: () => this.resolveContext(options.context, req, res),
      });

      const { headers, body, status } = httpGraphQLResponse;

      for (const [headerKey, headerValue] of headers) {
        res.header(headerKey, headerValue);
      }

      res.status(status ?? 200);

      if (body.kind === 'complete') {
        return res.send(body.string);
      }

      const readableStream = new ReadableStream({
        async start(controller) {
          for await (const chunk of body.asyncIterator) {
            controller.enqueue(new TextEncoder().encode(chunk));
          }
          controller.close();
        },
      });

      return new Response(readableStream, {
        status: status ?? 200,
        headers: [...headers],
      });
    });

    this.apolloServer = server;
  }

  /**
   * Stops HTTP and subscription GraphQL resources.
   */
  public async stop() {
    await this.subscriptionServer?.stop();
    await this.apolloServer?.stop();
  }

  private registerSubscriptions(options: ElysiaGraphQLDriverConfig) {
    const subscriptionOptions = options.subscriptions?.['graphql-ws'];
    if (!subscriptionOptions) {
      return;
    }

    const { httpAdapter } = this.httpAdapterHost;
    if (!(httpAdapter instanceof ElysiaAdapter)) {
      throw new Error('graphql-ws subscriptions require the Elysia adapter');
    }

    const schema = this.getSchema(options.schema);
    this.subscriptionServer = new ElysiaGraphQLWsSubscriptionServer(
      httpAdapter.getInstance(),
      schema,
      {
        ...(subscriptionOptions === true ? {} : subscriptionOptions),
        path:
          subscriptionOptions === true
            ? options.path
            : subscriptionOptions.path ?? options.path,
      },
    );
  }

  private getSchema(configuredSchema?: GraphQLSchema): GraphQLSchema {
    if (configuredSchema) {
      return configuredSchema;
    }

    const internals = this.apolloServer as unknown as {
      internals?: {
        state?: {
          schemaManager?: {
            getSchemaDerivedData?: () => { schema?: GraphQLSchema };
          };
        };
      };
    };
    const schema = internals.internals?.state?.schemaManager
      ?.getSchemaDerivedData?.().schema;

    if (!schema) {
      throw new Error('Unable to retrieve the GraphQL schema for graphql-ws');
    }

    return schema;
  }

  private httpHeadersToMap(headers: Headers | Record<string, string>) {
    const map = new HeaderMap();

    if (headers instanceof Headers) {
      headers.forEach((value, key) => map.set(key, value));
      return map;
    }

    for (const [key, value] of Object.entries(headers)) {
      map.set(key, value);
    }

    return map;
  }

  private async resolveContext(
    configuredContext: unknown,
    req: ElysiaRequest,
    res: ElysiaReply,
  ): Promise<BaseContext> {
    const context =
      typeof configuredContext === 'function'
        ? await configuredContext(
            { req, res },
            {
              method: req.method,
              url: req.url,
              body: req.body,
              headers: req.headers,
            },
          )
        : configuredContext;

    if (context === undefined || context === null) {
      return { req };
    }

    if (typeof context !== 'object' || 'req' in context) {
      return context as BaseContext;
    }

    return { ...context, req } as BaseContext;
  }

  private async parseBody(
    req: ElysiaRequest,
    uploadParser?: ElysiaGraphQLDriverConfig['uploadParser'],
  ): Promise<Record<string, unknown>> {
    const contentType = req.header('content-type');

    if (contentType?.startsWith('application/graphql')) {
      return { query: await req.text() };
    }

    if (contentType?.startsWith('application/json')) {
      if (req.body && typeof req.body === 'object') {
        return req.body as Record<string, unknown>;
      }
      return req.json().catch(this.logError) as Promise<Record<string, unknown>>;
    }

    if (contentType?.startsWith('application/x-www-form-urlencoded')) {
      return this.parseFormURL(req);
    }

    if (contentType?.startsWith('multipart/form-data')) {
      if (!uploadParser) {
        throw new Error(
          'GraphQL multipart uploads require an uploadParser from elysia-nestjs/uploads',
        );
      }
      return uploadParser(req);
    }

    return {};
  }

  private logError(e: unknown): void {
    if (e instanceof Error) {
      Logger.error(e.stack || e.message);
    }
    throw new Error(`POST body sent invalid JSON: ${e}`);
  }

  private async parseFormURL(req: ElysiaRequest) {
    if (req.body && typeof req.body === 'object') {
      return req.body as Record<string, unknown>;
    }

    const searchParams = new URLSearchParams(await req.text());
    return Object.fromEntries(searchParams.entries());
  }
}
