import * as vscode from "vscode";

// Message types from webview to extension
interface SendCodeMessage {
  type: "sendCode";
  email: string;
  username: string;
}

interface VerifyCodeMessage {
  type: "verifyCode";
  email: string;
  code: string;
}

interface SignOutMessage {
  type: "signOut";
}

type WebviewMessage = SendCodeMessage | VerifyCodeMessage | SignOutMessage;

export class AuthWebviewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = "userWebview";
  private _view?: vscode.WebviewView;
  private _context: vscode.ExtensionContext;

  constructor(
    private readonly _extensionUri: vscode.Uri,
    context: vscode.ExtensionContext,
  ) {
    this._context = context;
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  public resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken,
  ) {
    this._view = webviewView;

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [this._extensionUri],
    };

    webviewView.webview.html = this._getHtmlForWebview(webviewView.webview);

    // Load saved session if exists
    this.loadSavedSession();

    // Handle messages from the webview
    webviewView.webview.onDidReceiveMessage((message: WebviewMessage) => {
      switch (message.type) {
        case "sendCode":
          this.handleSendCode(message.email, message.username);
          break;
        case "verifyCode":
          this.handleVerifyCode(message.email, message.code);
          break;
        case "signOut":
          this.handleSignOut();
          break;
      }
    });
  }

  private async handleSendCode(email: string, username: string) {
    console.log("Sending verification code to:", email);

    try {
      const response = await fetch("http://localhost:3001/api/auth/send-code", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, username }),
      });

      if (response.ok) {
        await response.json(); // Consume the response
        vscode.window.showInformationMessage(
          `Verification code sent to ${email}! Check your inbox.`,
        );

        // Update the webview to show code input
        this._view?.webview.postMessage({
          type: "codeSent",
          email,
        });
      } else {
        const error = (await response.json()) as { message: string };
        vscode.window.showErrorMessage(`Failed to send code: ${error.message}`);
      }
    } catch (error) {
      vscode.window.showErrorMessage(
        `Error: ${error instanceof Error ? error.message : "Unknown error"}`,
      );
    }
  }

  private async handleVerifyCode(email: string, code: string) {
    console.log("Verifying code for:", email);

    try {
      const response = await fetch(
        "http://localhost:3001/api/auth/verify-code",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email, code }),
        },
      );

      if (response.ok) {
        const data = (await response.json()) as {
          token: string;
          user: { email: string; username: string };
        };

        vscode.window.showInformationMessage(
          `Welcome, ${data.user.username}! 🎉`,
        );

        // Save token and user info
        await this.saveSession(data.token, data.user);

        // Update the webview to show signed-in state
        this._view?.webview.postMessage({
          type: "signedIn",
          user: data.user,
        });
      } else {
        const error = (await response.json()) as { message: string };
        vscode.window.showErrorMessage(`Invalid code: ${error.message}`);
      }
    } catch (error) {
      vscode.window.showErrorMessage(
        `Verification error: ${error instanceof Error ? error.message : "Unknown error"}`,
      );
    }
  }

  private async handleSignOut() {
    // Clear stored credentials
    await this.clearSession();

    vscode.window.showInformationMessage("Signed out successfully");

    // Update the webview to show signed-out state
    this._view?.webview.postMessage({
      type: "signedOut",
    });
  }

  // Session management methods
  private async saveSession(
    token: string,
    user: { email: string; username: string },
  ) {
    await this._context.secrets.store("auth_token", token);
    await this._context.globalState.update("user", user);
  }

  private async loadSavedSession() {
    const token = await this._context.secrets.get("auth_token");
    const user = this._context.globalState.get<{
      email: string;
      username: string;
    }>("user");

    if (token && user) {
      console.log("✅ Loaded saved session for:", user.username);

      // Verify token is still valid by calling backend
      try {
        const response = await fetch("http://localhost:3001/api/auth/user", {
          method: "GET",
          headers: {
            Authorization: `Bearer ${token}`,
          },
        });

        if (response.ok) {
          // Token is valid, restore signed-in state
          this._view?.webview.postMessage({
            type: "signedIn",
            user: user,
          });
        } else {
          // Token is invalid, clear it
          console.log("❌ Saved token is invalid, clearing session");
          await this.clearSession();
        }
      } catch (error) {
        console.error("Error verifying saved session:", error);
        // Keep the session even if backend is down
        this._view?.webview.postMessage({
          type: "signedIn",
          user: user,
        });
      }
    }
  }

  private async clearSession() {
    await this._context.secrets.delete("auth_token");
    await this._context.globalState.update("user", undefined);
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  private _getHtmlForWebview(_webview: vscode.Webview) {
    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Authentication</title>
    <style>
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }

        html, body {
            height: 100%;
            overflow: hidden;
        }

        body {
            font-family: var(--vscode-font-family);
            color: var(--vscode-foreground);
            background-color: var(--vscode-sideBar-background);
            padding: 16px;
            display: flex;
            flex-direction: column;
            min-height: 100vh;
        }

        .container {
            flex: 1;
            display: flex;
            flex-direction: column;
        }

        .auth-form {
            display: flex;
            flex-direction: column;
            gap: 12px;
        }

        .form-group {
            display: flex;
            flex-direction: column;
            gap: 6px;
        }

        label {
            font-size: 12px;
            font-weight: 600;
            color: var(--vscode-foreground);
        }

        input {
            padding: 8px;
            background: var(--vscode-input-background);
            color: var(--vscode-input-foreground);
            border: 1px solid var(--vscode-input-border);
            border-radius: 4px;
            font-size: 13px;
        }

        input:focus {
            outline: none;
            border-color: var(--vscode-focusBorder);
        }

        button {
            padding: 8px 16px;
            background: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
            border: none;
            border-radius: 4px;
            cursor: pointer;
            font-size: 13px;
            font-weight: 600;
            transition: background 0.2s;
        }

        button:hover {
            background: var(--vscode-button-hoverBackground);
        }

        button:disabled {
            opacity: 0.5;
            cursor: not-allowed;
        }

        button.secondary {
            background: var(--vscode-button-secondaryBackground);
            color: var(--vscode-button-secondaryForeground);
        }

        button.secondary:hover {
            background: var(--vscode-button-secondaryHoverBackground);
        }

        .user-info {
            display: flex;
            flex-direction: column;
            gap: 12px;
            padding: 12px;
            background: var(--vscode-editor-background);
            border-radius: 6px;
            border: 1px solid var(--vscode-panel-border);
            margin-bottom: 16px;
        }

        .user-details {
            display: flex;
            flex-direction: column;
            gap: 4px;
        }

        .user-username {
            font-size: 14px;
            font-weight: 600;
        }

        .user-email {
            font-size: 12px;
            color: var(--vscode-descriptionForeground);
        }

        .title {
            font-size: 16px;
            font-weight: 600;
            margin-bottom: 16px;
        }

        .info-text {
            font-size: 12px;
            color: var(--vscode-descriptionForeground);
            margin-top: 8px;
            line-height: 1.4;
        }

        .code-input {
            text-align: center;
            letter-spacing: 8px;
            font-size: 18px;
            font-weight: 600;
            font-family: monospace;
        }

        .hidden {
            display: none;
        }

        .success-message {
            padding: 8px;
            background: var(--vscode-inputValidation-infoBackground);
            border: 1px solid var(--vscode-inputValidation-infoBorder);
            border-radius: 4px;
            font-size: 12px;
            margin-bottom: 12px;
        }

        .back-link {
            margin-top: 12px;
            font-size: 12px;
            color: var(--vscode-textLink-foreground);
            cursor: pointer;
            text-align: center;
        }

        .back-link:hover {
            text-decoration: underline;
        }

        /* Placeholder for future history section */
        .history-section {
            flex: 1;
            margin-top: 16px;
            padding-top: 16px;
            border-top: 1px solid var(--vscode-panel-border);
        }

        .history-title {
            font-size: 14px;
            font-weight: 600;
            margin-bottom: 12px;
            color: var(--vscode-foreground);
        }

        .history-item {
            padding: 8px;
            background: var(--vscode-editor-background);
            border: 1px solid var(--vscode-panel-border);
            border-radius: 4px;
            margin-bottom: 8px;
            cursor: pointer;
            transition: all 0.2s;
        }

        .history-item:hover {
            background: var(--vscode-list-hoverBackground);
        }

        .history-item-name {
            font-size: 13px;
            font-weight: 600;
            margin-bottom: 2px;
        }

        .history-item-date {
            font-size: 11px;
            color: var(--vscode-descriptionForeground);
        }
    </style>
</head>
<body>
    <div class="container">
        <!-- Signed Out View -->
        <div id="signedOutView">
            <h2 class="title">🔐 Authentication</h2>
            
            <!-- Email Input Form -->
            <div id="emailForm" class="auth-form">
                <div class="form-group">
                    <label for="username">Username</label>
                    <input type="text" id="username" placeholder="johndoe" />
                </div>
                <div class="form-group">
                    <label for="email">Email</label>
                    <input type="email" id="email" placeholder="your@email.com" />
                </div>
                <button onclick="sendCode()">Send Verification Code</button>
                <p class="info-text">
                    📧 We'll send a 6-digit code to your email for passwordless sign-in.
                </p>
            </div>

            <!-- Code Verification Form -->
            <div id="codeForm" class="auth-form hidden">
                <div class="success-message">
                    ✅ Code sent to <span id="sentEmail"></span>
                </div>
                <div class="form-group">
                    <label for="code">Verification Code</label>
                    <input 
                        type="text" 
                        id="code" 
                        class="code-input"
                        placeholder="000000" 
                        maxlength="6"
                        autocomplete="off"
                    />
                </div>
                <button onclick="verifyCode()">Verify & Sign In</button>
                <div class="back-link" onclick="showEmailForm()">
                    ← Back to email
                </div>
                <p class="info-text">
                    Check your email for a 6-digit verification code.
                </p>
            </div>
        </div>

        <!-- Signed In View -->
        <div id="signedInView" class="hidden">
            <h2 class="title">👤 Account</h2>
            <div class="user-info">
                <div class="user-details">
                    <div class="user-username" id="userUsername"></div>
                    <div class="user-email" id="userEmail"></div>
                </div>
                <button class="secondary" onclick="signOut()">Sign Out</button>
            </div>

            <!-- Placeholder for History Section (to be implemented) -->
            <div class="history-section">
                <div class="history-title">📜 Saved Roadmaps</div>
                <p class="info-text">Your saved project roadmaps will appear here.</p>
                <!-- Future: List of saved roadmaps -->
            </div>
        </div>
    </div>

    <script>
        const vscode = acquireVsCodeApi();
        let currentEmail = '';

        function showEmailForm() {
            document.getElementById('emailForm').classList.remove('hidden');
            document.getElementById('codeForm').classList.add('hidden');
        }

        function showCodeForm() {
            document.getElementById('emailForm').classList.add('hidden');
            document.getElementById('codeForm').classList.remove('hidden');
        }

        function sendCode() {
            const username = document.getElementById('username').value.trim();
            const email = document.getElementById('email').value.trim();

            if (!username) {
                alert('Please enter a username');
                return;
            }

            if (!email) {
                alert('Please enter an email');
                return;
            }

            if (!email.includes('@')) {
                alert('Please enter a valid email');
                return;
            }

            currentEmail = email;

            vscode.postMessage({
                type: 'sendCode',
                email,
                username
            });
        }

        function verifyCode() {
            const code = document.getElementById('code').value.trim();

            if (!code || code.length !== 6) {
                alert('Please enter a 6-digit code');
                return;
            }

            vscode.postMessage({
                type: 'verifyCode',
                email: currentEmail,
                code
            });
        }

        function signOut() {
            vscode.postMessage({
                type: 'signOut'
            });
        }

        // Listen for messages from the extension
        window.addEventListener('message', event => {
            const message = event.data;
            
            switch (message.type) {
                case 'codeSent':
                    currentEmail = message.email;
                    document.getElementById('sentEmail').textContent = message.email;
                    showCodeForm();
                    // Focus on code input
                    setTimeout(() => {
                        document.getElementById('code').focus();
                    }, 100);
                    break;
                    
                case 'signedIn':
                    document.getElementById('signedOutView').classList.add('hidden');
                    document.getElementById('signedInView').classList.remove('hidden');
                    document.getElementById('userUsername').textContent = '👤 ' + message.user.username;
                    document.getElementById('userEmail').textContent = message.user.email;
                    break;
                    
                case 'signedOut':
                    document.getElementById('signedOutView').classList.remove('hidden');
                    document.getElementById('signedInView').classList.add('hidden');
                    showEmailForm();
                    // Clear form inputs
                    document.getElementById('username').value = '';
                    document.getElementById('email').value = '';
                    document.getElementById('code').value = '';
                    currentEmail = '';
                    break;
            }
        });

        // Auto-format code input (digits only)
        document.getElementById('code').addEventListener('input', (e) => {
            const input = e.target;
            input.value = input.value.replace(/[^0-9]/g, '');
        });
    </script>
</body>
</html>`;
  }
}
