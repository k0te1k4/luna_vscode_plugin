"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.syncDocsFromCloud = syncDocsFromCloud;
const vscode = __importStar(require("vscode"));
const path = __importStar(require("path"));
function cacheRoot(context, version) {
    return vscode.Uri.joinPath(context.globalStorageUri, 'kb', version);
}
function docsRoot(context, version) {
    return vscode.Uri.joinPath(cacheRoot(context, version), 'docs');
}
function manifestUri(context, version) {
    return vscode.Uri.joinPath(cacheRoot(context, version), 'manifest.json');
}
async function readManifest(uri) {
    try {
        const raw = await vscode.workspace.fs.readFile(uri);
        const s = Buffer.from(raw).toString('utf8');
        const parsed = JSON.parse(s);
        if (!parsed || typeof parsed !== 'object')
            return {};
        return parsed;
    }
    catch (_a) {
        return {};
    }
}
async function writeManifest(uri, m) {
    const parent = uri.with({ path: path.posix.dirname(uri.path) });
    await vscode.workspace.fs.createDirectory(parent);
    const bytes = Buffer.from(JSON.stringify(m, null, 2), 'utf8');
    await vscode.workspace.fs.writeFile(uri, bytes);
}
function sanitizeRel(rel) {
    // prevent path traversal
    const cleaned = rel.replace(/\\/g, '/').replace(/^\/+/, '');
    const parts = cleaned.split('/').filter(p => p && p !== '.' && p !== '..');
    return parts.join('/');
}
async function syncDocsFromCloud(params) {
    var _a, _b, _c;
    const { context, storage, version, objects } = params;
    const mUri = manifestUri(context, version);
    const manifest = await readManifest(mUri);
    // Ensure the docs cache root exists even if there are no objects in the cloud yet.
    // This prevents downstream code (indexer) from failing with ENOENT on scandir.
    await vscode.workspace.fs.createDirectory(docsRoot(context, version));
    const currentKeys = new Set(objects.map(o => o.key));
    let downloaded = 0;
    let skipped = 0;
    let removed = 0;
    // remove stale files from cache
    for (const oldKey of Object.keys(manifest)) {
        if (!currentKeys.has(oldKey)) {
            delete manifest[oldKey];
            removed++;
        }
    }
    const total = Math.max(1, objects.length);
    let i = 0;
    for (const obj of objects) {
        i++;
        if ((_a = params.cancellationToken) === null || _a === void 0 ? void 0 : _a.isCancellationRequested)
            throw new Error('Sync cancelled');
        const old = manifest[obj.key];
        const same = old && old.etag && obj.etag && old.etag === obj.etag && old.size === obj.size;
        if (same) {
            skipped++;
            (_b = params.progress) === null || _b === void 0 ? void 0 : _b.report({ message: `KB cache: up-to-date (${storage.relativeName(version, 'docs', obj.key)})`, increment: (1 / total) * 100 });
            continue;
        }
        const rel = sanitizeRel(storage.relativeName(version, 'docs', obj.key));
        const target = vscode.Uri.joinPath(docsRoot(context, version), ...rel.split('/'));
        await vscode.workspace.fs.createDirectory(vscode.Uri.joinPath(target, '..'));
        (_c = params.progress) === null || _c === void 0 ? void 0 : _c.report({ message: `KB cache: downloading ${rel}`, increment: (1 / total) * 100 });
        await storage.downloadToFile(obj.key, target);
        manifest[obj.key] = {
            etag: obj.etag,
            size: obj.size,
            lastModified: obj.lastModified ? obj.lastModified.toISOString() : undefined
        };
        downloaded++;
    }
    await writeManifest(mUri, manifest);
    return {
        downloaded,
        skipped,
        removed,
        cacheDocsRoot: docsRoot(context, version)
    };
}
//# sourceMappingURL=sync.js.map