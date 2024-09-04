import { configure, Fetch, fs, Overlay } from '@zenfs/core';
import { cd, cwd, resolve } from '@zenfs/core/emulation/path.js';
import type { IndexData } from '@zenfs/core/backends/index/index.js';
import { IndexedDB } from '@zenfs/dom';
import 'fake-indexeddb/auto';
import { lookup } from 'mime-types';
import { existsSync, readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { basename, extname, join } from 'node:path';
import { inspect } from 'node:util';
import { createInterface } from 'node:readline';
import chalk from 'chalk';

const port = 11730;

const serverPath = join(import.meta.dirname, '../data');

createServer((request, response) => {
	if (!existsSync(serverPath + request.url)) {
		response.writeHead(404).end();
		return;
	}

	response
		.writeHead(200, { 'Content-Type': lookup(request.url) || 'text/plain' })
		.end(readFileSync(serverPath + request.url, 'utf8'));
}).listen(port);

let index: IndexData;
try {
	index = JSON.parse(readFileSync('index.json', 'utf8'));
} catch (e) {
	console.error('Invalid index.');
	process.exit();
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

async function copy(source: string, destination: string): Promise<void> {
	const folderQueue: string[] = [];

	const stats = await fs.promises.stat(source);
	if (stats.isDirectory()) {
		folderQueue.push(source);
	}

	const success = await copyHandler(source, destination);
	if (!success) {
		console.log('cp: failed');
	}
}

function ls(dir: string = '.') {
	const list = fs
		.readdirSync(dir)
		.map(name => (fs.statSync(join(dir, name)).isDirectory() ? chalk.blue(name) : name))
		.join(' ');
	console.log(list);
}

const helpText = `
Virtual FS shell.
Available commands: help, ls, cp, cd, mv, rm, cat, stat, pwd, exit/quit
Run "default" to attempt bug reproduction.
`;

await configure<typeof Overlay>({
	mounts: {
		'/': {
			backend: Overlay,
			readable: { backend: Fetch, index, baseUrl: `http://localhost:${port}/` },
			writable: { backend: IndexedDB, storeName: 'fs-cache' },
		},
	},
});

const cli = createInterface({
	input: process.stdin,
	output: process.stdout,
	prompt: chalk.green('/') + '$ ',
});

console.log(helpText);
cli.prompt();

async function exec(line: string) {
	cli.pause();
	const [command, ...args] = line.trim().split(' ');
	try {
		switch (command) {
			case 'help':
				console.log(helpText);
				break;
			case 'ls':
				ls(args[0]);
				break;
			case 'cd':
				cd(args[0] || resolve('.'));
				cli.setPrompt(chalk.green(cwd) + '$ ');
				break;
			case 'cp':
				await copy(args[0], args[1]);
				break;
			case 'mv':
				fs.renameSync(args[0], args[1]);
				console.log(`Moved ${args[0]} to ${args[1]}`);
				break;
			case 'rm':
				fs.unlinkSync(args[0]);
				console.log(`Removed ${args[0]}`);
				break;
			case 'cat':
				console.log(fs.readFileSync(args[0], 'utf8'));
				break;
			case 'stat':
				console.log(inspect(fs.statSync(args[0]), { colors: true }));
				break;
			case 'pwd':
				console.log(cwd);
				break;
			case 'exit':
			case 'quit':
				console.log('Exiting...');
				cli.close();
				return;
			case 'default':
				{
					cli.setPrompt('> ');
					for (const command of [
						'cp /simple.txt /Desktop',
						'cp /simple.txt /Documents',
						'ls Desktop',
						'ls Documents',
					]) {
						cli.prompt();
						console.log(command);
						await exec(command);
					}
					cli.setPrompt(chalk.green(cwd) + '$ ');
				}
				break;
			default:
				console.log(`Unknown command: ${command}`);
		}
	} catch (error) {
		console.error('Error:', error.message);
	}

	cli.prompt();
	cli.resume();
}

cli.on('line', exec);

cli.on('close', () => {
	process.exit(0);
});
