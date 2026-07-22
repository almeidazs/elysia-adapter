# elysia-nestjs

`elysia-nestjs` is a NestJS 11 HTTP adapter backed by [Elysia](https://elysiajs.com/). It supports Bun natively and Node.js through Elysia's official Node adapter.

The package has three intentional entry points:

| Import | Provides |
| --- | --- |
| `elysia-nestjs` | HTTP adapter and public request/reply types |
| `elysia-nestjs/graphql` | Apollo GraphQL HTTP driver and `graphql-ws` subscriptions |
| `elysia-nestjs/uploads` | Optional REST multipart helpers and GraphQL Upload scalar |

## Requirements

- NestJS 11 (`@nestjs/common` and `@nestjs/core`)
- Bun, or Node.js with `@elysia/node`
- `reflect-metadata` and `rxjs` in the Nest application

GraphQL is opt-in and requires `@nestjs/graphql`, `@nestjs/apollo`, `@apollo/server`, and `graphql`. The complete, current list of Elysia constructor options is maintained in the [Elysia documentation](https://elysiajs.com/); this adapter forwards those options unchanged.

## Installation

```bash
bun add elysia-nestjs elysia @nestjs/common @nestjs/core reflect-metadata rxjs
```

For Node.js, add the official adapter:

```bash
bun add @elysia/node
```

For GraphQL:

```bash
bun add @nestjs/graphql @nestjs/apollo @apollo/server graphql
```

For subscriptions, add the protocol implementation:

```bash
bun add graphql-ws
```

Uploads are included only when importing `elysia-nestjs/uploads`; no extra package is needed.

## Quick start

### Bun

```ts
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { ElysiaAdapter } from 'elysia-nestjs';
import { AppModule } from './app.module';

const app = await NestFactory.create(AppModule, new ElysiaAdapter());
await app.listen(3000);
```

### Node.js

```ts
import 'reflect-metadata';
import { node } from '@elysia/node';
import { NestFactory } from '@nestjs/core';
import { ElysiaAdapter } from 'elysia-nestjs';
import { AppModule } from './app.module';

const app = await NestFactory.create(
  AppModule,
  new ElysiaAdapter({ adapter: node() }),
);
await app.listen(3000);
```

## HTTP adapter

Nest controllers, middleware, guards, interceptors, filters, versioning, and `StreamableFile` responses are dispatched through the adapter. The request object exposed to Nest is a Fetch-style `ElysiaRequest`; its original `Request` is available as `req.raw`.

```ts
import { Body, Controller, Get, Param, Post, Req } from '@nestjs/common';
import type { ElysiaRequest } from 'elysia-nestjs';

@Controller('users')
export class UsersController {
  @Get(':id')
  findOne(@Param('id') id: string, @Req() req: ElysiaRequest) {
    return { id, query: req.query };
  }

  @Post()
  create(@Body() body: unknown) {
    return body;
  }
}
```

Pass any Elysia constructor option directly to `ElysiaAdapter`:

```ts
const adapter = new ElysiaAdapter({
  name: 'api',
  strictPath: true,
  aot: true,
  serve: { maxRequestBodySize: 10 * 1024 * 1024 },
});
```

### Body parsers and raw bodies

Nest registers JSON, text, and URL-encoded parsers during application initialization. To capture the original bytes or set a per-parser limit, configure the adapter before bootstrapping:

```ts
const adapter = new ElysiaAdapter();
adapter.useBodyParser('application/json', true, 1024 * 1024);

const app = await NestFactory.create(AppModule, adapter);
```

`req.rawBody` is a `Buffer` when raw capture is enabled. Invalid JSON produces a Nest `400` error; bodies over the configured limit produce `413`.

### CORS

`enableCors` installs the official [`@elysiajs/cors`](https://elysiajs.com/plugins/cors) plugin. Use that plugin's option names:

```ts
app.enableCors({
  origin: ['https://app.example.com'],
  methods: ['GET', 'POST', 'PATCH', 'DELETE'],
  allowedHeaders: ['content-type', 'authorization'],
  credentials: true,
  maxAge: 86_400,
});
```

The plugin handles preflight requests and does not reflect an origin that is not allowed.

### Static files

Static serving uses the official [`@elysiajs/static`](https://elysiajs.com/plugins/static) plugin. Configure it on the adapter:

```ts
const adapter = new ElysiaAdapter();
adapter.useStaticAssets({
  assets: 'public',
  prefix: '/assets',
  indexHTML: true,
  maxAge: 86_400,
});
```

The legacy `adapter.useStaticAssets('/assets', options)` form is also supported.

## GraphQL

Import GraphQL support only when the application needs it:

```ts
import { GraphQLModule } from '@nestjs/graphql';
import {
  ElysiaGraphQLDriver,
  type ElysiaGraphQLDriverConfig,
} from 'elysia-nestjs/graphql';

@Module({
  imports: [
    GraphQLModule.forRoot<ElysiaGraphQLDriverConfig>({
      driver: ElysiaGraphQLDriver,
      autoSchemaFile: true,
      path: '/graphql',
      context: ({ req, res }) => ({ req, res }),
    }),
  ],
})
export class AppModule {}
```

The driver supports GraphQL HTTP queries, mutations, contexts, Apollo errors, and incremental HTTP responses.

### Subscriptions with `graphql-ws`

Subscriptions use the `graphql-ws` protocol only. It is registered directly on Elysia's WebSocket hooks, so it works with Bun and Elysia's Node adapter without a Node HTTP-server bridge.

```ts
GraphQLModule.forRoot<ElysiaGraphQLDriverConfig>({
  driver: ElysiaGraphQLDriver,
  autoSchemaFile: true,
  path: '/graphql',
  subscriptions: {
    'graphql-ws': {
      path: '/graphql',
      connectionInitWaitTimeout: 5_000,
    },
  },
});
```

The subscription server starts as part of the GraphQL driver and closes active sockets during Nest shutdown. Configure clients with `graphql-ws` and the `graphql-transport-ws` subprotocol. Nest recommends this protocol instead of the legacy transport; see the [Nest subscription guide](https://docs.nestjs.com/graphql/subscriptions).

## Optional uploads

REST multipart interceptors and the GraphQL Upload scalar live in the optional entry point:

```ts
import {
  FileInterceptor,
  GraphQLUpload,
  UploadedFile,
} from 'elysia-nestjs/uploads';
```

Use the REST helpers with normal Nest interceptors. For GraphQL, add `GraphQLUpload` to your resolvers, use `Upload` in the schema, and opt in to multipart parsing:

```ts
import { graphQLUploadParser } from 'elysia-nestjs/uploads';

GraphQLModule.forRoot<ElysiaGraphQLDriverConfig>({
  driver: ElysiaGraphQLDriver,
  uploadParser: graphQLUploadParser,
});
```

Upload code is not imported by the HTTP or GraphQL entry points unless it is explicitly requested.

## Limitations

- View engines are not supported.
- Only `graphql-ws` is supported for subscriptions; `subscriptions-transport-ws` is intentionally not installed.
- The adapter exposes Fetch-style requests, not Express request/response objects. Express-specific middleware should be replaced with Nest middleware or Elysia-compatible code.
- Uploads are optional and are not part of the core request path.

## Troubleshooting

- **Node does not listen:** pass `adapter: node()` from `@elysia/node` to `ElysiaAdapter`.
- **CORS configuration has no effect:** use `methods` and `allowedHeaders`, the official Elysia CORS option names, rather than Express aliases.
- **Subscription client disconnects immediately:** use a `graphql-ws` client and `graphql-transport-ws`; do not configure the legacy protocol.
- **Webhook signature verification fails:** enable raw-body capture before creating the Nest application.

## Development and publishing

```bash
bun install
bun run typecheck
bun test
bun run build
bun pm pack --dry-run
```

`bun run build` emits ESM and declaration files to `dist`. The package export map intentionally exposes only `.`, `./graphql`, and `./uploads`.
