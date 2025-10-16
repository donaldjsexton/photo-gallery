import http from 'node:http';
import { readFile, stat, access, mkdir, unlink, readdir } from 'node:fs/promises';
import { createReadStream, createWriteStream } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = 8080;
const ROOT_PUBLIC = path.join(__dirname, '..', 'public');
const ROOT_UPLOADS = path.join(__dirname, '..', 'uploads');
await mkdir(path.join(ROOT_UPLOADS, 'original'), {recursive: true });
const MIME = {
	'.html': 'text/html; charset=utf-8', 
	'.js': 'text/javascript; charset=utf-8',
	'.css': 'text/css; charset=utf-8',
	'.png': 'image/png',
	'.jpg': 'image/jpeg',
	'.jpeg': 'image/jpeg',
	'.webp': 'image/webp',
	'.gif': 'image/gif',
	'.svg': 'image/svg+xml',
	'.json': 'application/json; charset=utf-8'
};

function send(res,code, headers = {}, body = '') {
	res.writeHead(code, headers);
	if (body instanceof Buffer) res.end(body);
	else res.end(body.toString());
}

function serveFile(res, filepath) {
	const ext = path.extname(filepath).toLowerCase();
	const type = MIME[ext] || 'application/octet-stream';
	stat(filepath).then(
		s => {
			res.writeHead(200, {
				'Content-Type': type,
				'Content-Length': s.size,
				'Cache-Control': ext.match(/\.(png|jpe?g|webp|gif|svg)$/) ? 'public, max-age=31536000, immutable' : 'no-cache'
			});
			createReadStream(filepath).pipe(res);
		},
		() => send(res, 404, {'Content-Type': 'text/plain; charset=utf-8'}, 'Not found')
	);
}

function safeJoin(root, reqPath) {
	const p = path.normalize(path.join(root, reqPath));
	if (!p.startsWith(root)) return null;
	return p;
}

const server = http.createServer(async (req, res) => {
	try {
		const url = new URL(req.url, `http://${req.headers.host}`);
		const { pathname } = url;

	if (pathname === '/healthz') {
		return send(res, 200, {'Content-Type':'text/plain; charset=utf-8'}, 'ok');
	}

	if (pathname.startsWith('/api/')) {
		if (pathname === '/api/images' && req.method === 'GET') {
			const dir = path.join(ROOT_UPLOADS, 'original');
			let entries = [];
			try {
				entries = await readdir(dir, {withFileTypes: true });
			} catch {}

			const files = await Promise.all(
				entries
				.filter(d => d.isFile())
				.map(async d => {
					const filePath = path.join(dir, d.name);
					const s = await stat(filePath);
					return { name: d.name, mtime: s.mtimeMs };
				})
			);
			files.sort((a, b) => b.mtime - a.mtime);

			const items = files.map(f => ({
				name: f.name,
				full: `/uploads/original/${encodeURIComponent(f.name)}`
			}));

	return send(res, 200, {'Content-Type':'application/json; charset=utf-8'}, JSON.stringify({ items })
	);
	}
		if (pathname === '/api/upload' && req.method === 'POST') {
			const name = (url.searchParams.get('name') || `${Date.now()}.bin`);
			const safeName = path.basename(name).replace(/[^\w.\-]/g, '_');
			const destPath = path.join(ROOT_UPLOADS, 'original', safeName);

			const limit = 20 * 1024 * 1024; //20 MB
			let bytes = 0;
			let aborted = false;
			const out = createWriteStream(destPath);

			req.on('data', chunk => {
				bytes += chunk.length;
				if (bytes > limit && !aborted) {
					aborted = true;
					out.destroy();
					req.destroy();
				}
			});

		out.on('finish', () => {
			if (aborted) return;
			send(res, 201, {'Content-Type':'application/json; charset=utf-8'},
				JSON.stringify({ ok: true, path: `/uploads/original/${safeName}`, bytes }));
		});
		out.on('error', async () => {
				try { await unlink(destPath); } catch {}
				if (!aborted) send(res, 500, {'Content-Type': 'application/json; charset=utf-8'}, JSON.stringify({ error: 'Write failed' }));
			});
		req.on('close', async () => {
			if (aborted) {
				try {await unlink(destPath); } catch {}
				send(res, 413, {'Content-Type':'application/json; charset=utf-8'}, JSON.stringify({ error: 'Too large' }));
			}
		});
			return req.pipe(out);
		}
	return send(res, 404, {'Content-Type':'application/json; charset=utf-8'}, JSON.stringify({error:'not found'}));
	}
	if (pathname.startsWith('/uploads/')){
	const filePath = safeJoin(ROOT_UPLOADS, pathname.replace('/uploads/',''));
	if (!filePath) return send(res, 400, {'Content-Type':'text/plain; charset=utf-8'}, 'Bad path');
	return serveFile(res, filePath);
	}

let rel = pathname === '/' ? '/index.html' : pathname;
const publicPath = safeJoin(ROOT_PUBLIC, rel);
	if (!publicPath) return send(res, 400, {'Content-Type': 'text/plain; charset=utf-8'}, 'Bad path');

	try {
		await access(publicPath);
		return serveFile(res, publicPath);
	} catch {
		return send(res, 404, {'Content-Type':'text/plain; charset=utf-8'}, 'Not found');
	}
} catch (e) {
	console.error(e);
	return send(res, 500, {'Content-Type': 'text/plain; charset=utf-8'}, 'Server error');
}
});

server.listen(PORT, () => {
	console.log(`Vanilla server: http://localhost:${PORT}`);
});
