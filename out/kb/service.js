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
exports.KnowledgeBaseService = void 0;
const vscode = __importStar(require("vscode"));
const path = __importStar(require("path"));
const storage_1 = require("./storage");
const config_1 = require("./config");
const secrets_1 = require("./secrets");
const sync_1 = require("./sync");
const projectsView_1 = require("./projectsView");
const pdf_1 = require("./pdf");
class KnowledgeBaseService {
    constructor(context, storage) {
        this.context = context;
        this.storage = storage;
        this.cfg = (0, config_1.getKbConfig)();
    }
    getActiveFolder() {
        var _a, _b;
        const docUri = (_a = vscode.window.activeTextEditor) === null || _a === void 0 ? void 0 : _a.document.uri;
        if (docUri) {
            const folder = vscode.workspace.getWorkspaceFolder(docUri);
            if (folder)
                return folder;
        }
        return (_b = vscode.workspace.workspaceFolders) === null || _b === void 0 ? void 0 : _b[0];
    }
    getVersionForFolder(folder) {
        const f = folder || this.getActiveFolder();
        if (f) {
            return (0, projectsView_1.getProjectVersion)(f) || this.cfg.defaultVersion;
        }
        return this.cfg.defaultVersion;
    }
    async listVersions() {
        const vers = await this.storage.listVersions();
        return vers.map(v => v.name);
    }
    async selectVersion(version, folderUri) {
        const folder = folderUri ? vscode.workspace.getWorkspaceFolder(folderUri) : this.getActiveFolder();
        if (!folder)
            throw new Error('No workspace folder');
        const versions = await this.listVersions();
        const picked = version
            ? version
            : await vscode.window.showQuickPick(versions.length ? versions : [this.cfg.defaultVersion], {
                title: 'Select LuNA documentation version',
                canPickMany: false
            });
        if (!picked)
            return this.getVersionForFolder(folder);
        await (0, projectsView_1.setProjectVersion)(folder.uri, picked);
        return picked;
    }
    /** Ensure docs for version are cached locally under globalStorage. */
    async syncDocs(version, progress, token) {
        const objects = await this.storage.listObjects(version, 'docs');
        return await (0, sync_1.syncDocsFromCloud)({
            context: this.context,
            storage: this.storage,
            version,
            objects,
            progress,
            cancellationToken: token
        });
    }
    docsCacheRoot(version) {
        return vscode.Uri.joinPath(this.context.globalStorageUri, 'kb', version, 'docs').fsPath;
    }
    /** Download an object to a temp location and open in editor. */
    async openObject(target) {
        const tmpDir = vscode.Uri.joinPath(this.context.globalStorageUri, 'tmp');
        await vscode.workspace.fs.createDirectory(tmpDir);
        const filename = path.posix.basename(target.key);
        const tmp = vscode.Uri.joinPath(tmpDir, `${Date.now()}_${filename}`);
        await this.storage.downloadToFile(target.key, tmp);
        // Let VS Code choose appropriate opener (PDF viewer, text, etc.)
        await vscode.commands.executeCommand('vscode.open', tmp, { preview: true });
    }
    async promptSetStorageCredentials() {
        const accessKeyId = await vscode.window.showInputBox({
            title: 'Yandex Object Storage Access Key ID',
            prompt: 'Enter Access Key ID',
            ignoreFocusOut: true
        });
        if (!accessKeyId)
            return;
        const secretAccessKey = await vscode.window.showInputBox({
            title: 'Yandex Object Storage Secret Access Key',
            prompt: 'Enter Secret Access Key',
            password: true,
            ignoreFocusOut: true
        });
        if (!secretAccessKey)
            return;
        await (0, secrets_1.setS3Credentials)(this.context, { accessKeyId: accessKeyId.trim(), secretAccessKey: secretAccessKey.trim() });
        vscode.window.showInformationMessage('LuNA KB: storage credentials saved.');
    }
    async clearStorageCredentials() {
        await (0, secrets_1.clearS3Credentials)(this.context);
        vscode.window.showInformationMessage('LuNA KB: storage credentials cleared.');
    }
    async uploadFiles(version, category, files, baseFolder) {
        for (const file of files) {
            const rel = baseFolder ? path.posix.relative(baseFolder.fsPath.replace(/\\/g, '/'), file.fsPath.replace(/\\/g, '/')) : path.posix.basename(file.fsPath);
            const safeRel = rel.replace(/\\/g, '/').replace(/^\/+/, '');
            const key = `${(0, storage_1.categoryPrefix)(version, category)}/${safeRel}`.replace(/\\/g, '/').replace(/\/+/g, '/');
            const contentType = guessContentType(file);
            await this.storage.uploadFromFile(file, key, contentType);
        }
    }
    async createVersion(versionName) {
        const name = versionName
            ? versionName
            : await vscode.window.showInputBox({ title: 'Create KB version', prompt: 'Version name (e.g. luna6, luna7)', ignoreFocusOut: true });
        if (!name)
            return undefined;
        await this.storage.ensureVersionExists(name.trim());
        return name.trim();
    }
    /**
     * Upload thesis PDF into raw/ and an extracted markdown into docs/ (best-effort).
     */
    async importThesisPdf(version, pdfUri) {
        var _a;
        const basename = path.posix.basename(pdfUri.fsPath).replace(/\s+/g, '_');
        const rawKey = `${(0, storage_1.categoryPrefix)(version, 'raw')}/thesis/${basename}`.replace(/\\/g, '/').replace(/\/+/g, '/');
        await this.storage.uploadFromFile(pdfUri, rawKey, 'application/pdf');
        try {
            const text = await (0, pdf_1.extractPdfText)(pdfUri);
            const md = `# Thesis: ${basename}\n\n` + text + `\n`;
            const mdKey = `${(0, storage_1.categoryPrefix)(version, 'docs')}/thesis/${basename}.md`.replace(/\\/g, '/').replace(/\/+/g, '/');
            await this.storage.uploadBytes(Buffer.from(md, 'utf8'), mdKey, 'text/markdown; charset=utf-8');
        }
        catch (e) {
            // Keep raw PDF anyway.
            vscode.window.showWarningMessage(`PDF uploaded, but text extraction failed: ${(_a = e === null || e === void 0 ? void 0 : e.message) !== null && _a !== void 0 ? _a : String(e)}`);
        }
    }
    async deleteObject(key) {
        await this.storage.deleteObject(key);
    }
}
exports.KnowledgeBaseService = KnowledgeBaseService;
function guessContentType(uri) {
    const p = uri.fsPath.toLowerCase();
    if (p.endsWith('.md') || p.endsWith('.markdown'))
        return 'text/markdown; charset=utf-8';
    if (p.endsWith('.txt'))
        return 'text/plain; charset=utf-8';
    if (p.endsWith('.pdf'))
        return 'application/pdf';
    if (p.endsWith('.json'))
        return 'application/json; charset=utf-8';
    if (p.endsWith('.yaml') || p.endsWith('.yml'))
        return 'text/yaml; charset=utf-8';
    return undefined;
}
//# sourceMappingURL=service.js.map