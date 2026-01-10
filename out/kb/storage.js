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
exports.KnowledgeBaseStorage = void 0;
exports.versionPrefix = versionPrefix;
exports.categoryPrefix = categoryPrefix;
const path = __importStar(require("path"));
const vscode = __importStar(require("vscode"));
const client_s3_1 = require("@aws-sdk/client-s3");
const s3_1 = require("./s3");
const config_1 = require("./config");
const secrets_1 = require("./secrets");
function joinKey(...parts) {
    const s = parts
        .filter(Boolean)
        .map(p => p.replace(/^\/+/, '').replace(/\/+$/, ''))
        .join('/');
    return s.replace(/\/+/g, '/');
}
function versionPrefix(version) {
    const cfg = (0, config_1.getKbConfig)();
    const base = (0, config_1.normalizePrefix)(cfg.basePrefix);
    return joinKey(base, version);
}
function categoryPrefix(version, category) {
    return joinKey(versionPrefix(version), category);
}
class KnowledgeBaseStorage {
    constructor(context) {
        this.context = context;
        this.s3Promise = null;
        this.s3CfgFingerprint = null;
    }
    async isReady() {
        const cfg = (0, config_1.getKbConfig)();
        if (!cfg.enabled)
            return false;
        if (!cfg.bucket)
            return false;
        const creds = await (0, secrets_1.getS3Credentials)(this.context);
        return !!creds;
    }
    async s3() {
        const cfg = (0, config_1.getKbConfig)();
        const fp = `${cfg.enabled}|${cfg.bucket}|${cfg.endpoint}|${cfg.region}`;
        if (this.s3CfgFingerprint && this.s3CfgFingerprint !== fp) {
            // settings changed
            this.s3Promise = null;
        }
        this.s3CfgFingerprint = fp;
        if (!this.s3Promise) {
            this.s3Promise = (async () => {
                const creds = await (0, secrets_1.getS3Credentials)(this.context);
                if (!creds) {
                    throw new Error('Yandex Object Storage credentials are not set. Run: LuNA KB: Set Storage Credentials');
                }
                if (!cfg.bucket) {
                    throw new Error('Yandex Object Storage bucket is not set. Set setting: luna.kb.storage.bucket');
                }
                return (0, s3_1.createS3Client)(cfg, creds);
            })();
        }
        return this.s3Promise;
    }
    async listVersions() {
        const cfg = (0, config_1.getKbConfig)();
        if (cfg.knownVersions.length) {
            return cfg.knownVersions.map(name => ({ name }));
        }
        const s3 = await this.s3();
        const base = (0, config_1.normalizePrefix)(cfg.basePrefix);
        const prefix = base ? `${base}/` : '';
        const cmd = new client_s3_1.ListObjectsV2Command({
            Bucket: cfg.bucket,
            Prefix: prefix,
            Delimiter: '/'
        });
        const out = await s3.send(cmd);
        const cps = out.CommonPrefixes || [];
        const versions = cps
            .map(cp => cp.Prefix || '')
            .map(p => p.replace(prefix, '').replace(/\/$/, ''))
            .filter(Boolean)
            .sort();
        return versions.map(name => ({ name }));
    }
    async ensureVersionExists(version) {
        const cfg = (0, config_1.getKbConfig)();
        const s3 = await this.s3();
        const key = joinKey(versionPrefix(version), '.keep');
        await s3.send(new client_s3_1.PutObjectCommand({
            Bucket: cfg.bucket,
            Key: key,
            Body: 'keep',
            ContentType: 'text/plain'
        }));
    }
    async listObjects(version, category) {
        const cfg = (0, config_1.getKbConfig)();
        const s3 = await this.s3();
        const pref = `${categoryPrefix(version, category)}/`;
        const objects = [];
        let ContinuationToken = undefined;
        for (;;) {
            const out = await s3.send(new client_s3_1.ListObjectsV2Command({
                Bucket: cfg.bucket,
                Prefix: pref,
                ContinuationToken
            }));
            for (const obj of out.Contents || []) {
                if (!obj.Key || obj.Key.endsWith('/'))
                    continue;
                objects.push(mapObj(obj));
            }
            if (!out.IsTruncated)
                break;
            ContinuationToken = out.NextContinuationToken;
            if (!ContinuationToken)
                break;
        }
        objects.sort((a, b) => a.key.localeCompare(b.key));
        return objects;
    }
    async headObject(key) {
        const cfg = (0, config_1.getKbConfig)();
        const s3 = await this.s3();
        try {
            const out = await s3.send(new client_s3_1.HeadObjectCommand({ Bucket: cfg.bucket, Key: key }));
            return {
                key,
                size: out.ContentLength || 0,
                lastModified: out.LastModified,
                etag: out.ETag
            };
        }
        catch (_a) {
            return null;
        }
    }
    async downloadToFile(key, targetUri) {
        const cfg = (0, config_1.getKbConfig)();
        const s3 = await this.s3();
        const out = await s3.send(new client_s3_1.GetObjectCommand({ Bucket: cfg.bucket, Key: key }));
        const body = out.Body;
        if (!body)
            throw new Error(`Empty body for ${key}`);
        const chunks = [];
        // @aws-sdk/client-s3 body is a stream in Node
        const stream = body;
        for await (const chunk of stream) {
            chunks.push(chunk instanceof Uint8Array ? chunk : new Uint8Array(chunk));
        }
        const data = Buffer.concat(chunks.map(c => Buffer.from(c)));
        await vscode.workspace.fs.writeFile(targetUri, data);
    }
    async uploadFromFile(localUri, key, contentType) {
        const cfg = (0, config_1.getKbConfig)();
        const s3 = await this.s3();
        const data = await vscode.workspace.fs.readFile(localUri);
        await s3.send(new client_s3_1.PutObjectCommand({
            Bucket: cfg.bucket,
            Key: key,
            Body: Buffer.from(data),
            ContentType: contentType
        }));
    }
    async uploadBytes(bytes, key, contentType) {
        const cfg = (0, config_1.getKbConfig)();
        const s3 = await this.s3();
        await s3.send(new client_s3_1.PutObjectCommand({
            Bucket: cfg.bucket,
            Key: key,
            Body: Buffer.from(bytes),
            ContentType: contentType
        }));
    }
    async deleteObject(key) {
        const cfg = (0, config_1.getKbConfig)();
        const s3 = await this.s3();
        await s3.send(new client_s3_1.DeleteObjectCommand({ Bucket: cfg.bucket, Key: key }));
    }
    /** Convert object key to a friendly name relative to version/category prefix. */
    relativeName(version, category, key) {
        const pref = `${categoryPrefix(version, category)}/`;
        if (key.startsWith(pref))
            return key.slice(pref.length);
        return path.posix.basename(key);
    }
}
exports.KnowledgeBaseStorage = KnowledgeBaseStorage;
function mapObj(obj) {
    return {
        key: obj.Key || '',
        size: obj.Size || 0,
        lastModified: obj.LastModified,
        etag: obj.ETag
    };
}
//# sourceMappingURL=storage.js.map