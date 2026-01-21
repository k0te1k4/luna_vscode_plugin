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
exports.KnowledgeBaseTreeProvider = void 0;
const vscode = __importStar(require("vscode"));
const config_1 = require("./config");
class KnowledgeBaseTreeProvider {
    constructor(context, storage) {
        this.context = context;
        this.storage = storage;
        this._onDidChangeTreeData = new vscode.EventEmitter();
        this.onDidChangeTreeData = this._onDidChangeTreeData.event;
    }
    refresh() {
        this._onDidChangeTreeData.fire();
    }
    getTreeItem(element) {
        var _a;
        switch (element.kind) {
            case 'root': {
                const item = new vscode.TreeItem('LuNA Knowledge Base', vscode.TreeItemCollapsibleState.Expanded);
                item.contextValue = 'lunaKbRoot';
                return item;
            }
            case 'status': {
                const item = new vscode.TreeItem(element.text, vscode.TreeItemCollapsibleState.None);
                item.contextValue = 'lunaKbStatus';
                item.iconPath = new vscode.ThemeIcon('info');
                return item;
            }
            case 'version': {
                const item = new vscode.TreeItem(element.version, vscode.TreeItemCollapsibleState.Collapsed);
                item.contextValue = 'lunaKbVersion';
                item.iconPath = new vscode.ThemeIcon('library');
                item.command = {
                    command: 'luna.kb.selectVersion',
                    title: 'Select version',
                    arguments: [element.version]
                };
                return item;
            }
            case 'category': {
                const label = element.category === 'docs'
                    ? 'Docs (wiki, indexed)'
                    : element.category === 'user-files'
                        ? 'User files (indexed)'
                        : 'Raw';
                const item = new vscode.TreeItem(label, vscode.TreeItemCollapsibleState.Collapsed);
                item.contextValue = 'lunaKbCategory';
                item.iconPath = new vscode.ThemeIcon(element.category === 'docs' ? 'book' : element.category === 'user-files' ? 'files' : 'file-binary');
                return item;
            }
            case 'object': {
                const rel = this.storage.relativeName(element.version, element.category, element.object.key);
                const item = new vscode.TreeItem(rel, vscode.TreeItemCollapsibleState.None);
                item.contextValue =
                    element.category === 'docs'
                        ? 'lunaKbObjectDocs'
                        : element.category === 'user-files'
                            ? 'lunaKbObjectUser'
                            : 'lunaKbObject';
                item.iconPath = new vscode.ThemeIcon('file');
                item.description = `${Math.round((element.object.size || 0) / 1024)} KB`;
                item.tooltip = `${element.object.key}\n${((_a = element.object.lastModified) === null || _a === void 0 ? void 0 : _a.toISOString()) || ''}`;
                item.command = {
                    command: 'luna.kb.openObject',
                    title: 'Open',
                    arguments: [element]
                };
                return item;
            }
        }
    }
    async getChildren(element) {
        if (!element) {
            return [{ kind: 'root' }];
        }
        if (element.kind === 'root') {
            const cfg = (0, config_1.getKbConfig)();
            if (!cfg.enabled)
                return [{ kind: 'status', text: 'KB is disabled (luna.kb.enabled=false)' }];
            if (!cfg.bucket)
                return [{ kind: 'status', text: 'Set luna.kb.storage.bucket' }];
            if (!(await this.storage.isReady()))
                return [{ kind: 'status', text: 'Run: LuNA KB: Set Storage Credentials' }];
            const versions = await this.storage.listVersions();
            if (!versions.length)
                return [{ kind: 'status', text: 'No versions found (create one)' }];
            return versions.map(v => ({ kind: 'version', version: v.name }));
        }
        if (element.kind === 'version') {
            return [
                { kind: 'category', version: element.version, category: 'docs' },
                { kind: 'category', version: element.version, category: 'user-files' },
                { kind: 'category', version: element.version, category: 'raw' }
            ];
        }
        if (element.kind === 'category') {
            const objects = await this.storage.listObjects(element.version, element.category);
            if (!objects.length)
                return [{ kind: 'status', text: 'Empty' }];
            return objects.map(o => ({ kind: 'object', version: element.version, category: element.category, object: o }));
        }
        return [];
    }
}
exports.KnowledgeBaseTreeProvider = KnowledgeBaseTreeProvider;
//# sourceMappingURL=tree.js.map