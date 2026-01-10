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
exports.LunaProjectsTreeProvider = void 0;
exports.getProjectVersion = getProjectVersion;
exports.setProjectVersion = setProjectVersion;
const vscode = __importStar(require("vscode"));
const config_1 = require("./config");
class LunaProjectsTreeProvider {
    constructor() {
        this._onDidChangeTreeData = new vscode.EventEmitter();
        this.onDidChangeTreeData = this._onDidChangeTreeData.event;
    }
    refresh() {
        this._onDidChangeTreeData.fire();
    }
    getTreeItem(element) {
        if (element.kind === 'status') {
            const item = new vscode.TreeItem(element.text, vscode.TreeItemCollapsibleState.None);
            item.contextValue = 'lunaProjectStatus';
            item.iconPath = new vscode.ThemeIcon('info');
            return item;
        }
        const folder = element.folder;
        const version = getProjectVersion(folder) || (0, config_1.getKbConfig)().defaultVersion;
        const item = new vscode.TreeItem(folder.name, vscode.TreeItemCollapsibleState.None);
        item.contextValue = 'lunaProjectFolder';
        item.description = `LuNA docs: ${version}`;
        item.iconPath = new vscode.ThemeIcon('folder');
        item.command = {
            command: 'luna.kb.selectVersionForFolder',
            title: 'Select LuNA version',
            arguments: [folder.uri]
        };
        return item;
    }
    getChildren() {
        const folders = vscode.workspace.workspaceFolders || [];
        if (!folders.length)
            return [{ kind: 'status', text: 'Open a folder/workspace' }];
        return folders.map(f => ({ kind: 'folder', folder: f }));
    }
}
exports.LunaProjectsTreeProvider = LunaProjectsTreeProvider;
function getProjectVersion(folder) {
    const cfg = vscode.workspace.getConfiguration('luna', folder.uri);
    const v = cfg.get('kb.projectVersion', '');
    const s = (v || '').trim();
    return s || undefined;
}
async function setProjectVersion(folderUri, version) {
    const folder = vscode.workspace.getWorkspaceFolder(folderUri);
    if (!folder)
        throw new Error('Workspace folder not found');
    const cfg = vscode.workspace.getConfiguration('luna', folder.uri);
    await cfg.update('kb.projectVersion', version, vscode.ConfigurationTarget.WorkspaceFolder);
}
//# sourceMappingURL=projectsView.js.map