import { configure, Fetch, fs, Overlay } from '@zenfs/core';
import type { IndexData } from '@zenfs/core/backends/index/index.js';
import { IndexedDB } from '@zenfs/dom';
import { lookup } from 'mime-types';
import { existsSync, readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { basename, extname } from 'node:path';
import { inspect } from 'node:util';

const port = 11730;

createServer((request, response) => {
	if (!existsSync(request.url)) {
		response.writeHead(404).end();
		return;
	}

	response.writeHead(200, { 'Content-Type': lookup(request.url) || 'text/plain' }).end(readFileSync(request.url, 'utf8'));
}).listen(port);

let isInitialized = false;

let index: IndexData;
try {
	index = JSON.parse(readFileSync('index.json', 'utf8'));
} catch (e) {
	console.error('Invalid index.');
	process.exit();
}

async function initZenFSAsync(): Promise<void> {
	if (isInitialized) {
		return;
	}
	await configure<typeof Overlay>({
		mounts: {
			'/': {
				backend: Overlay,
				readable: { backend: Fetch, index, baseUrl: `http://localhost:${port}/` },
				writable: { backend: IndexedDB, storeName: 'fs-cache' },
			},
		},
	});
	isInitialized = true;
}

function fileName(path: string): string {
	return `${basename(path, extname(path))}${extname(path)}`;
}

async function copyFileAsync(source: string, destinationDirectory: string): Promise<boolean> {
	const destination = destinationDirectory + '/' + fileName(source);
	console.log('Destination:', destination);
	await fs.promises.copyFile(source, destination);
	return true;
}

async function copyHandler(source: string, destination: string): Promise<boolean> {
	const stats = await fs.promises.stat(source);
	if (stats.isDirectory()) {
		// ignoring directories for now
		return true;
	}
	const success = await copyFileAsync(source, destination);
	console.log(`Copy ${source} -> ${destination} succeeded: ${success}`);
	return success;
}

declare function successHandler(destination: string): void;

async function copy(source: string, destination: string): Promise<void> {
	const folderQueue: string[] = [];

	const stats = await fs.promises.stat(source);
	if (stats.isDirectory()) {
		folderQueue.push(source);
	}

	const success = await copyHandler(source, destination);
	if (success) {
		successHandler(destination);
	}
}

async function main() {
	await initZenFSAsync();
	console.log('Copy #1');
	await copy('/simple.txt', '/Desktop');
	console.log('Copy #2');
	await copy('/simple.txt', '/Documents');
}

main();
