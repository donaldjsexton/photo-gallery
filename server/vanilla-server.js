import http from "node:http";
import { stat, access, mkdir, unlink, readdir } from "node:fs/promises";
import { createReadStream, createWriteStream } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = 8080;
const ROOT_PUBLIC = path.join(__dirname, "..", "public");
const ROOT_UPLOADS = path.join(__dirname, "..", "uploads");

// --- storage layout ---
const TMP_DIR = path.join(ROOT_UPLOADS, "tmp");
const MASTER_DIR = path.join(ROOT_UPLOADS, "master");
const THUMB_DIR = path.join(ROOT_UPLOADS, "thumbs");

// ensure dirs exist
await mkdir(TMP_DIR, { recursive: true });
await mkdir(MASTER_DIR, { recursive: true });
await mkdir(THUMB_DIR, { recursive: true });

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".json": "application/json; charset=utf-8",
};

function send(res, code, headers = {}, body = "") {
  res.writeHead(code, headers);
  if (body instanceof Buffer) res.end(body);
  else res.end(body.toString());
}
function serveFile(res, filepath) {
  const ext = path.extname(filepath).toLowerCase();
  const type = MIME[ext] || "application/octet-stream";
  stat(filepath).then(
    (s) => {
      res.writeHead(200, {
        "Content-Type": type,
        "Content-Length": s.size,
        "Cache-Control": ext.match(/\.(png|jpe?g|webp|gif|svg)$/)
          ? "public, max-age=31536000, immutable"
          : "no-cache",
      });
      createReadStream(filepath).pipe(res);
    },
    () =>
      send(
        res,
        404,
        { "Content-Type": "text/plain; charset=utf-8" },
        "Not found",
      ),
  );
}

function safeJoin(root, reqPath) {
  const p = path.normalize(path.join(root, reqPath));
  if (!p.startsWith(root)) return null;
  return p;
}

function isImageMagic(buf) {
  if (!buf || buf.length < 12) return false;
  //jpg
  if (buf[0] === 0xff && buf[1] === 0xd8) return true;
  //png
  if (
    buf[0] === 0x89 &&
    buf[1] === 0x50 &&
    buf[2] === 0x4e &&
    buf[3] === 0x47 &&
    buf[4] === 0x0d &&
    buf[5] === 0x0a &&
    buf[6] === 0x1a &&
    buf[7] === 0x0a
  )
    return true;
  //gif
  if (
    (buf[0] === 0x47 &&
      buf[1] === 0x49 &&
      buf[2] === 0x46 &&
      buf[3] === 0x38 &&
      buf[4] === 0x37) ||
    (buf[4] === 0x39 && buf[5] === 0x61)
  )
    return true;
  // WebP: "RIFF" .... "WEBP"
  if (
    buf[0] === 0x52 &&
    buf[1] === 0x49 &&
    buf[2] === 0x46 &&
    buf[3] === 0x46 &&
    buf[8] === 0x57 &&
    buf[9] === 0x45 &&
    buf[10] === 0x42 &&
    buf[11] === 0x50
  )
    return true;

  // AVIF/HEIC (ISO-BMFF): bytes 4-7 = 'ftyp', then brand contains 'avif','heic','heif','mif1','msf1'
  if (
    buf[4] === 0x66 &&
    buf[5] === 0x74 &&
    buf[6] === 0x79 &&
    buf[7] === 0x70
  ) {
    const brand = buf.subarray(8, 16).toString("ascii");
    if (/(avif|heic|heif|mif1|msf1)/.test(brand)) return true;
  }

  return false;
}

function runConvert(args) {
  return new Promise((resolve, reject) => {
    const proc = spawn("magick", args);
    let stderr = "";
    proc.stderr.on("data", (d) => {
      stderr += d;
    });
    proc.on("exit", (code) =>
      code === 0 ? resolve() : reject(new Error(`convert failed: ${stderr}`)),
    );
  });
}

// convenience paths
const masterPath = (id) => path.join(MASTER_DIR, `${id}.jpg`);
const thumbPath = (id, w = 640) => path.join(THUMB_DIR, `${id}-${w}.webp`);

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const { pathname } = url;

    if (pathname === "/healthz") {
      return send(
        res,
        200,
        { "Content-Type": "text/plain; charset=utf-8" },
        "ok",
      );
    }

    if (pathname.startsWith("/api/")) {
      // LIST (from master/)
      if (pathname === "/api/images" && req.method === "GET") {
        let entries = [];
        try {
          entries = await readdir(MASTER_DIR, { withFileTypes: true });
        } catch {}
        const files = await Promise.all(
          entries
            .filter((d) => d.isFile() && !d.name.startsWith("."))
            .map(async (d) => {
              const s = await stat(path.join(MASTER_DIR, d.name));
              const id = path.parse(d.name).name; // strip .jpg
              return { id, name: d.name, mtime: s.mtimeMs };
            }),
        );
        files.sort((a, b) => b.mtime - a.mtime);

        const items = files.map((f) => ({
          id: f.id,
          name: f.name,
          full: `/uploads/master/${f.name}`,
          thumb: `/uploads/thumbs/${f.id}-640.webp`,
        }));

        return send(
          res,
          200,
          { "Content-Type": "application/json; charset=utf-8" },
          JSON.stringify({ items }),
        );
      }

      // DELETE (remove master + thumb(s) + any stale tmp)
      if (pathname === "/api/images" && req.method === "DELETE") {
        const id = url.searchParams.get("id") || ""; // delete by id now
        const name = url.searchParams.get("name"); // backward compat
        const targetId = id || (name ? path.parse(name).name : "");
        if (!targetId) {
          return send(
            res,
            400,
            { "Content-Type": "application/json; charset=utf-8" },
            JSON.stringify({ error: "Missing ?id=" }),
          );
        }
        const targets = [
          masterPath(targetId),
          thumbPath(targetId, 640),
          thumbPath(targetId, 320),
          thumbPath(targetId, 1280),
          path.join(TMP_DIR, `${targetId}.upload`),
        ];
        await Promise.allSettled(targets.map((p) => unlink(p)));
        return send(
          res,
          200,
          { "Content-Type": "application/json; charset=utf-8" },
          JSON.stringify({ ok: true }),
        );
      }

      // UPLOAD (stream -> tmp; then convert to master+thumb; abort-safe)
      if (pathname === "/api/upload" && req.method === "POST") {
        const id = Date.now().toString(36);
        const tmp = path.join(TMP_DIR, `${id}.upload`);

        const limit = 50 * 1024 * 1024; // 50 MB
        let bytes = 0;
        let aborted = false;
        let validated = false;
        let head = Buffer.alloc(0);
        let out = null;

        req.on("data", (chunk) => {
          bytes += chunk.length;
          if (bytes > limit && !aborted) {
            aborted = true;
            out.destroy();
            req.destroy();
          }
        });

        const cleanup = async () => {
          try {
            await unlink(tmp);
          } catch {}
        };

        req.pipe(out);

        req.on("aborted", cleanup);
        out.on("error", cleanup);

        out.on("finish", async () => {
          if (aborted) return;

          const master = masterPath(id);
          const thumb = thumbPath(id, 640);

          try {
            // master: max long edge 5400px, quality 88, progressive
            await runConvert([
              tmp,
              "-strip",
              "-resize",
              "5400x5400>",
              "-quality",
              "88",
              "-interlace",
              "Plane",
              master,
            ]);

            const thumbSizes = [320, 640, 1280];
            for (const w of thumbSizes) {
              const dir = path.join(THUMB_DIR, String(w));
              await mkdir(dir, { recursive: true });
              const dest = path.join(dir, `${id}-${w}.webp`);
              await runConvert([
                tmp,
                "-strip",
                "-resize",
                `${w}x${w}>`,
                "-quality",
                "80",
                dest,
              ]);
            }
            await cleanup();

            return send(
              res,
              201,
              { "Content-Type": "application/json; charset=utf-8" },
              JSON.stringify({
                ok: true,
                id,
                master: `/uploads/master/${path.basename(master)}`,
                thumb: `/uploads/thumbs/${path.basename(thumb)}`,
              }),
            );
          } catch (err) {
            console.error("convert fail", err);
            await cleanup();
            return send(
              res,
              500,
              { "Content-Type": "application/json; charset=utf-8" },
              JSON.stringify({ error: "conversion failed" }),
            );
          }
        });

        return; // stop fallthrough for this route
      }

      // fallback /api
      return send(
        res,
        404,
        { "Content-Type": "application/json; charset=utf-8" },
        JSON.stringify({ error: "not found" }),
      );
    }

    // static: /uploads/*
    if (pathname.startsWith("/uploads/")) {
      const filePath = safeJoin(
        ROOT_UPLOADS,
        pathname.replace("/uploads/", ""),
      );
      if (!filePath)
        return send(
          res,
          400,
          { "Content-Type": "text/plain; charset=utf-8" },
          "Bad path",
        );
      return serveFile(res, filePath);
    }

    // static: /public
    const rel = pathname === "/" ? "/index.html" : pathname;
    const publicPath = safeJoin(ROOT_PUBLIC, rel);
    if (!publicPath)
      return send(
        res,
        400,
        { "Content-Type": "text/plain; charset=utf-8" },
        "Bad path",
      );

    try {
      await access(publicPath);
      return serveFile(res, publicPath);
    } catch {
      return send(
        res,
        404,
        { "Content-Type": "text/plain; charset=utf-8" },
        "Not found",
      );
    }
  } catch (e) {
    console.error(e);
    return send(
      res,
      500,
      { "Content-Type": "text/plain; charset=utf-8" },
      "Server error",
    );
  }
});

server.listen(PORT, () => {
  console.log(`Vanilla server: http://localhost:${PORT}`);
});
