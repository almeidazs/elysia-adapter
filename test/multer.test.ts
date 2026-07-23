import { describe, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathExists } from '../src/multer/fs';
import { handleMultipartAnyFiles } from '../src/multer/multipart/handlers/any-files';
import { handleMultipartSingleFile } from '../src/multer/multipart/handlers/single-file';
import type { TElysiaRequest } from '../src/multer/multipart/request';
import { DiskStorage } from '../src/multer/storage/disk-storage';
import { MemoryStorage } from '../src/multer/storage/memory-storage';

describe('multipart helpers', () => {
	test('stores a single uploaded file and preserves body fields', async () => {
		const request = {
			body: {
				document: new File(['payload'], 'document.txt', {
					type: 'text/plain',
				}),
				description: 'test-file',
			},
			header(name: string) {
				return name === 'content-type' ? 'multipart/form-data' : undefined;
			},
		} as unknown as TElysiaRequest;

		const result = await handleMultipartSingleFile(request, 'document', {
			storage: new MemoryStorage(),
		});

		expect(result.file?.originalFilename).toBe('document.txt');
		expect(result.body.description).toBe('test-file');
		await result.remove();
	});

	test('removes a disk-backed single upload', async () => {
		const destination = await mkdtemp(join(tmpdir(), 'elysia-nestjs-'));
		const request = {
			body: {
				document: new File(['payload'], 'document.txt', {
					type: 'text/plain',
				}),
			},
			header(name: string) {
				return name === 'content-type' ? 'multipart/form-data' : undefined;
			},
		} as unknown as TElysiaRequest;

		try {
			const result = await handleMultipartSingleFile(request, 'document', {
				storage: new DiskStorage({ dest: destination, removeAfter: true }),
			});
			const path = result.file && 'path' in result.file ? result.file.path : '';

			await result.remove();

			expect(await pathExists(path)).toBe(false);
		} finally {
			await rm(destination, { recursive: true, force: true });
		}
	});

	test('enforces the configured per-field file limit', async () => {
		const request = {
			body: {
				documents: [
					new File(['first'], 'first.txt', { type: 'text/plain' }),
					new File(['second'], 'second.txt', { type: 'text/plain' }),
				],
			},
			header(name: string) {
				return name === 'content-type' ? 'multipart/form-data' : undefined;
			},
		} as unknown as TElysiaRequest;

		await expect(
			handleMultipartAnyFiles(request, {
				storage: new MemoryStorage(),
				limits: { files: 1 },
			}),
		).rejects.toThrow('accepts max 1 files');
	});
});
