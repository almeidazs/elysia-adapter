import type { Elysia, ElysiaConfig } from 'elysia';
import type { CORSConfig } from '@elysiajs/cors';
import type { HttpServer, INestApplication } from '@nestjs/common';
import { StreamableFile } from '@nestjs/common';

/**
 * Supported content types for the built-in body parser registration API.
 */
export type TypeBodyParser =
  | 'application/json'
  | 'text/plain'
  | 'application/x-www-form-urlencoded';

/**
 * Public request shape exposed by the adapter to Nest middleware, guards and handlers.
 */
export interface ElysiaRequest {
  raw: Request;
  url: string;
  method: string;
  signal: AbortSignal;
  headers: Record<string, string>;
  body?: unknown;
  rawBody?: Buffer;
  query?: Record<string, unknown>;
  params?: Record<string, string>;
  ip?: string;
  originalUrl?: string;
  routePath?: string;
  header(name: string): string | undefined;
  text(): Promise<string>;
  json(): Promise<unknown>;
  formData(): Promise<FormData>;
  arrayBuffer(): Promise<ArrayBuffer>;
  clone(): Request;
}

/**
 * Public response wrapper used by the adapter to emulate the Nest HTTP contract.
 */
export class ElysiaReply {
  public statusCode = 200;
  public readonly headers = new Headers();
  public body: unknown;
  public headersSent = false;
  public locals: Record<string, unknown> = {};

  constructor(public readonly request: ElysiaRequest) {}

  get finalized(): boolean {
    return this.headersSent;
  }

  public status(code: number): this {
    this.statusCode = code;
    return this;
  }

  public code(code: number): this {
    return this.status(code);
  }

  public set(name: string | Record<string, string>, value?: string): this {
    if (typeof name === 'string') {
      if (value !== undefined) {
        this.headers.set(name, value);
      }
      return this;
    }

    for (const [header, headerValue] of Object.entries(name)) {
      this.headers.set(header, headerValue);
    }

    return this;
  }

  public header(name: string, value?: string): this | string | undefined {
    if (value === undefined) {
      return this.headers.get(name) ?? undefined;
    }

    this.headers.set(name, value);
    return this;
  }

  public append(name: string, value: string): this {
    this.headers.append(name, value);
    return this;
  }

  public get(name: string): string | undefined {
    return this.headers.get(name) ?? undefined;
  }

  public removeHeader(name: string): this {
    this.headers.delete(name);
    return this;
  }

  public type(value: string): this {
    this.headers.set('content-type', value);
    return this;
  }

  public json(body: unknown): this {
    if (!this.headers.has('content-type')) {
      this.type('application/json; charset=utf-8');
    }
    this.body = body;
    this.headersSent = true;
    return this;
  }

  public send(body?: unknown): this {
    this.body = body;
    this.headersSent = true;
    return this;
  }

  public end(body?: unknown): this {
    this.body = body ?? null;
    this.headersSent = true;
    return this;
  }

  public redirect(statusOrUrl: number | string, url?: string): this {
    const statusCode = typeof statusOrUrl === 'number' ? statusOrUrl : 302;
    const location = typeof statusOrUrl === 'number' ? url : statusOrUrl;

    if (location) {
      this.headers.set('location', location);
    }

    this.statusCode = statusCode;
    this.body = null;
    this.headersSent = true;
    return this;
  }
}

/**
 * Public options accepted by `app.useStaticAssets()`.
 */
export interface ElysiaStaticAssetsOptions {
  assets?: string;
  prefix?: string;
  staticLimit?: number;
  alwaysStatic?: boolean;
  ignorePatterns?: Array<string | RegExp>;
  extension?: boolean;
  headers?: Record<string, string>;
  etag?: boolean;
  directive?:
    | 'public'
    | 'private'
    | 'must-revalidate'
    | 'no-cache'
    | 'no-store'
    | 'no-transform'
    | 'proxy-revalidate'
    | 'immutable';
  maxAge?: number | null;
  indexHTML?: boolean;
  bunFullstack?: boolean;
  decodeURI?: boolean;
  silent?: boolean;
}

/** Options forwarded to the official `@elysiajs/cors` plugin. */
export type ElysiaCorsOptions = CORSConfig;

/**
 * Options forwarded directly to the `new Elysia(options)` constructor.
 *
 * Pass `adapter: node()` when running on Node.js.
 */
export type ElysiaAdapterOptions = ElysiaConfig<string>;

/**
 * Nest application contract returned by `NestFactory.create()` when using `ElysiaAdapter`.
 */
export interface NestElysiaApplication<
  TServer extends Elysia = Elysia,
> extends INestApplication<TServer> {
  getHttpAdapter(): HttpServer<ElysiaRequest, ElysiaReply, Elysia>;
  useBodyParser(
    type: TypeBodyParser,
    rawBody?: boolean,
    bodyLimit?: number,
  ): this;
  useStaticAssets(
    prefix: string,
    options?: ElysiaStaticAssetsOptions,
  ): this;
  listen(
    port: number | string,
    callback?: (err?: Error, address?: string) => void,
  ): Promise<TServer>;
  listen(
    port: number | string,
    address: string,
    callback?: (err?: Error, address?: string) => void,
  ): Promise<TServer>;
  listen(
    port: number | string,
    address: string,
    backlog: number,
    callback?: (err?: Error, address?: string) => void,
  ): Promise<TServer>;
}

/**
 * Type guard for Nest's `StreamableFile`.
 */
export const isStreamableFile = (value: unknown): value is StreamableFile =>
  value instanceof StreamableFile;
