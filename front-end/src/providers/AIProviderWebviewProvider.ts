// front-end/src/providers/AIProviderWebviewProvider.ts

import * as vscode from "vscode";
import { AIService, AIProvider, PROVIDERS } from "../services/aiService";

export class AIProviderWebviewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = "aiProviderView";
  private _view?: vscode.WebviewView;
  private aiService: AIService;

  constructor(
    private readonly _extensionUri: vscode.Uri,
    private readonly _context: vscode.ExtensionContext,
    aiService: AIService,
  ) {
    this.aiService = aiService;
  }

  resolveWebviewView(webviewView: vscode.WebviewView) {
    this._view = webviewView;

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [this._extensionUri],
    };

    this.updateWebview();

    webviewView.webview.onDidReceiveMessage(async (message) => {
      switch (message.command) {
        case "selectProvider": {
          await this.aiService.setProvider(message.provider as AIProvider);
          this.updateWebview();
          break;
        }

        case "setApiKey": {
          await this.aiService.setApiKey(message.key);
          vscode.window.showInformationMessage("✓ API Key хадгалагдлаа");
          this.updateWebview();
          break;
        }

        case "clearApiKey": {
          await this.aiService.clearApiKey();
          vscode.window.showInformationMessage("✓ API Key устгагдлаа");
          this.updateWebview();
          break;
        }

        case "openKeyUrl": {
          const config = PROVIDERS[this.aiService.getProvider()];
          vscode.env.openExternal(vscode.Uri.parse(config.keyUrl));
          break;
        }

        case "askAI": {
          vscode.commands.executeCommand("experiment.askAI");
          break;
        }
      }
    });
  }

  private async updateWebview() {
    if (!this._view) return;

    const currentProvider = this.aiService.getProvider();
    const hasKey = await this.aiService.hasApiKey();
    const config = PROVIDERS[currentProvider];

    this._view.webview.html = this.getHtml(currentProvider, hasKey, config);
  }

  private getHtml(
    currentProvider: AIProvider,
    hasKey: boolean,
    config: {
      name: string;
      description: string;
      keyPlaceholder: string;
      free: boolean;
    },
  ): string {
    const providerOptions = Object.entries(PROVIDERS)
      .map(
        ([key, value]) => `
        <div class="provider-option ${key === currentProvider ? "selected" : ""}" 
             onclick="selectProvider('${key}')">
          <div class="provider-name">
            ${key === currentProvider ? "●" : "○"} ${value.name}
            ${value.free ? '<span class="free-badge">FREE</span>' : '<span class="paid-badge">PAID</span>'}
          </div>
          <div class="provider-desc">${value.description}</div>
        </div>
      `,
      )
      .join("");

    return `<!DOCTYPE html>
<html>
<head>
  <style>
    body {
      font-family: var(--vscode-font-family);
      padding: 10px;
      color: var(--vscode-foreground);
    }
    .section {
      margin-bottom: 16px;
    }
    .section-title {
      font-weight: bold;
      margin-bottom: 8px;
      font-size: 12px;
      text-transform: uppercase;
      opacity: 0.8;
    }
    .provider-option {
      padding: 8px;
      margin: 4px 0;
      border-radius: 4px;
      cursor: pointer;
      border: 1px solid var(--vscode-input-border);
    }
    .provider-option:hover {
      background: var(--vscode-list-hoverBackground);
    }
    .provider-option.selected {
      background: var(--vscode-list-activeSelectionBackground);
      border-color: var(--vscode-focusBorder);
    }
    .provider-name {
      font-weight: 500;
      display: flex;
      align-items: center;
      gap: 6px;
    }
    .provider-desc {
      font-size: 11px;
      opacity: 0.7;
      margin-left: 16px;
    }
    .free-badge {
      background: #2ea043;
      color: white;
      padding: 1px 5px;
      border-radius: 3px;
      font-size: 9px;
    }
    .paid-badge {
      background: #d29922;
      color: white;
      padding: 1px 5px;
      border-radius: 3px;
      font-size: 9px;
    }
    .key-section {
      margin-top: 12px;
      padding: 10px;
      background: var(--vscode-input-background);
      border-radius: 4px;
    }
    .key-status {
      display: flex;
      align-items: center;
      gap: 6px;
      margin-bottom: 8px;
    }
    .key-status.has-key {
      color: #2ea043;
    }
    .key-status.no-key {
      color: #d29922;
    }
    input {
      width: 100%;
      padding: 6px 8px;
      border: 1px solid var(--vscode-input-border);
      background: var(--vscode-input-background);
      color: var(--vscode-input-foreground);
      border-radius: 3px;
      margin: 6px 0;
      box-sizing: border-box;
    }
    button {
      width: 100%;
      padding: 8px;
      margin: 4px 0;
      border: none;
      border-radius: 4px;
      cursor: pointer;
      font-size: 13px;
    }
    .btn-primary {
      background: var(--vscode-button-background);
      color: var(--vscode-button-foreground);
    }
    .btn-primary:hover {
      background: var(--vscode-button-hoverBackground);
    }
    .btn-secondary {
      background: var(--vscode-button-secondaryBackground);
      color: var(--vscode-button-secondaryForeground);
    }
    .btn-ask {
      background: #2ea043;
      color: white;
      font-weight: bold;
      margin-top: 12px;
    }
    .btn-ask:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }
    .link {
      color: var(--vscode-textLink-foreground);
      cursor: pointer;
      font-size: 11px;
    }
  </style>
</head>
<body>
  <div class="section">
    <div class="section-title">🤖 AI Provider сонгох</div>
    ${providerOptions}
  </div>

  <div class="section key-section">
    <div class="section-title">🔑 API Key</div>
    <div class="key-status ${hasKey ? "has-key" : "no-key"}">
      ${hasKey ? "✓ Key тохируулсан" : "⚠ Key тохируулаагүй"}
    </div>
    
    ${
      !hasKey
        ? `
      <input type="password" id="apiKey" placeholder="${config.keyPlaceholder}" />
      <button class="btn-primary" onclick="saveKey()">💾 Хадгалах</button>
      <span class="link" onclick="openKeyUrl()">🔗 Key авах</span>
    `
        : `
      <button class="btn-secondary" onclick="clearKey()">🗑️ Key устгах</button>
    `
    }
  </div>

  <button class="btn-ask" onclick="askAI()" ${!hasKey ? "disabled" : ""}>
    💬 AI-аас асуух (Ctrl+Alt+A)
  </button>

  <script>
    const vscode = acquireVsCodeApi();
    
    function selectProvider(provider) {
      vscode.postMessage({ command: 'selectProvider', provider });
    }
    
    function saveKey() {
      const key = document.getElementById('apiKey').value;
      if (key) {
        vscode.postMessage({ command: 'setApiKey', key });
      }
    }
    
    function clearKey() {
      vscode.postMessage({ command: 'clearApiKey' });
    }
    
    function openKeyUrl() {
      vscode.postMessage({ command: 'openKeyUrl' });
    }
    
    function askAI() {
      vscode.postMessage({ command: 'askAI' });
    }
  </script>
</body>
</html>`;
  }
}
