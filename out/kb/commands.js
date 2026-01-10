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
exports.registerKbCommands = registerKbCommands;
const vscode = __importStar(require("vscode"));
function registerKbCommands(params) {
    const { context, kb, storage, tree, projects, statusBar } = params;
    async function updateStatus() {
        const folder = kb.getActiveFolder();
        const v = kb.getVersionForFolder(folder);
        statusBar.text = `LuNA KB: ${v}`;
        statusBar.tooltip = 'LuNA Knowledge Base version (click to change)';
    }
    const disposables = [];
    disposables.push(vscode.commands.registerCommand('luna.kb.refresh', async () => {
        tree.refresh();
        projects.refresh();
        await updateStatus();
    }), vscode.commands.registerCommand('luna.kb.setStorageCredentials', async () => {
        await kb.promptSetStorageCredentials();
        tree.refresh();
    }), vscode.commands.registerCommand('luna.kb.clearStorageCredentials', async () => {
        await kb.clearStorageCredentials();
        tree.refresh();
    }), vscode.commands.registerCommand('luna.kb.createVersion', async () => {
        await kb.createVersion();
        tree.refresh();
    }), vscode.commands.registerCommand('luna.kb.selectVersion', async (version) => {
        await kb.selectVersion(version);
        projects.refresh();
        await updateStatus();
    }), vscode.commands.registerCommand('luna.kb.selectVersionForFolder', async (folderUri) => {
        await kb.selectVersion(undefined, folderUri);
        projects.refresh();
        await updateStatus();
    }), vscode.commands.registerCommand('luna.kb.syncDocs', async () => {
        const folder = kb.getActiveFolder();
        const version = kb.getVersionForFolder(folder);
        await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: `LuNA KB: syncing ${version}`, cancellable: true }, async (progress, token) => {
            await kb.syncDocs(version, progress, token);
        });
        tree.refresh();
    }), vscode.commands.registerCommand('luna.kb.uploadDocs', async (version) => {
        const folder = kb.getActiveFolder();
        const v = version || kb.getVersionForFolder(folder);
        const uris = await vscode.window.showOpenDialog({ title: 'Upload docs files', canSelectMany: true, canSelectFiles: true });
        if (!(uris === null || uris === void 0 ? void 0 : uris.length))
            return;
        await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: `LuNA KB: uploading to ${v}/docs`, cancellable: true }, async (progress) => {
            progress.report({ message: `Uploading ${uris.length} file(s)...` });
            await kb.uploadFiles(v, 'docs', uris);
        });
        tree.refresh();
    }), vscode.commands.registerCommand('luna.kb.uploadRaw', async (version) => {
        const folder = kb.getActiveFolder();
        const v = version || kb.getVersionForFolder(folder);
        const uris = await vscode.window.showOpenDialog({ title: 'Upload raw files (PDF/audio/etc)', canSelectMany: true, canSelectFiles: true });
        if (!(uris === null || uris === void 0 ? void 0 : uris.length))
            return;
        await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: `LuNA KB: uploading to ${v}/raw`, cancellable: true }, async (progress) => {
            progress.report({ message: `Uploading ${uris.length} file(s)...` });
            await kb.uploadFiles(v, 'raw', uris);
        });
        tree.refresh();
    }), vscode.commands.registerCommand('luna.kb.uploadFolder', async (version) => {
        const folder = kb.getActiveFolder();
        const v = version || kb.getVersionForFolder(folder);
        const picked = await vscode.window.showOpenDialog({ title: 'Select folder to upload (docs)', canSelectFolders: true, canSelectFiles: false, canSelectMany: false });
        if (!(picked === null || picked === void 0 ? void 0 : picked.length))
            return;
        const base = picked[0];
        const files = await collectFilesRecursive(base);
        if (!files.length) {
            vscode.window.showWarningMessage('Folder is empty.');
            return;
        }
        await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: `LuNA KB: uploading folder to ${v}/docs`, cancellable: true }, async (progress) => {
            progress.report({ message: `Uploading ${files.length} file(s)...` });
            await kb.uploadFiles(v, 'docs', files, base);
        });
        tree.refresh();
    }), vscode.commands.registerCommand('luna.kb.importThesisPdf', async (version) => {
        const folder = kb.getActiveFolder();
        const v = version || kb.getVersionForFolder(folder);
        const picked = await vscode.window.showOpenDialog({
            title: 'Select thesis PDF to import',
            canSelectMany: false,
            canSelectFiles: true,
            filters: { PDF: ['pdf'] }
        });
        if (!(picked === null || picked === void 0 ? void 0 : picked.length))
            return;
        await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: `LuNA KB: importing thesis into ${v}`, cancellable: true }, async (progress) => {
            progress.report({ message: 'Uploading PDF + extracting text...' });
            await kb.importThesisPdf(v, picked[0]);
        });
        tree.refresh();
    }), vscode.commands.registerCommand('luna.kb.deleteObject', async (node) => {
        if (!node || node.kind !== 'object')
            return;
        const ok = await vscode.window.showWarningMessage(`Delete from cloud?\n${node.object.key}`, { modal: true }, 'Delete');
        if (ok !== 'Delete')
            return;
        await kb.deleteObject(node.object.key);
        tree.refresh();
    }), vscode.commands.registerCommand('luna.kb.openObject', async (node) => {
        if (!node || node.kind !== 'object')
            return;
        await kb.openObject({ version: node.version, category: node.category, key: node.object.key });
    }), vscode.commands.registerCommand('luna.kb.statusBar.selectVersion', async () => {
        await kb.selectVersion();
        projects.refresh();
        await updateStatus();
    }));
    context.subscriptions.push(...disposables);
    // update status on events
    context.subscriptions.push(vscode.window.onDidChangeActiveTextEditor(() => updateStatus()), vscode.workspace.onDidChangeWorkspaceFolders(() => updateStatus()), vscode.workspace.onDidChangeConfiguration(e => {
        if (e.affectsConfiguration('luna.kb')) {
            tree.refresh();
            projects.refresh();
            updateStatus();
        }
    }));
    // initial
    updateStatus();
}
async function collectFilesRecursive(root) {
    const out = [];
    async function walk(dir) {
        const entries = await vscode.workspace.fs.readDirectory(dir);
        for (const [name, type] of entries) {
            const uri = vscode.Uri.joinPath(dir, name);
            if (type === vscode.FileType.Directory) {
                if (name === '.git' || name === 'node_modules')
                    continue;
                await walk(uri);
            }
            else if (type === vscode.FileType.File) {
                out.push(uri);
            }
        }
    }
    await walk(root);
    out.sort((a, b) => a.fsPath.localeCompare(b.fsPath));
    return out;
}
//# sourceMappingURL=commands.js.map