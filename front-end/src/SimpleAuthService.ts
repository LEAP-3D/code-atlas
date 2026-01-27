import * as vscode from "vscode";

export interface User {
  id: string;
  email: string;
  firstName?: string;
  lastName?: string;
}

export class SimpleAuthService {
  private static instance: SimpleAuthService;
  private sessionToken: string | undefined;
  private user: User | undefined;

  private readonly API_BASE_URL = "http://localhost:3001/api";
  private readonly CLERK_URL = "https://proud-horse-28.clerk.accounts.dev"; // e.g., https://your-app.clerk.accounts.dev

  private constructor(private context: vscode.ExtensionContext) {
    this.loadSession();
  }

  static getInstance(context: vscode.ExtensionContext): SimpleAuthService {
    if (!SimpleAuthService.instance) {
      SimpleAuthService.instance = new SimpleAuthService(context);
    }
    return SimpleAuthService.instance;
  }

  private async loadSession(): Promise<void> {
    this.sessionToken = await this.context.secrets.get("session_token");
    if (this.sessionToken) {
      try {
        await this.fetchUser();
      } catch {
        this.sessionToken = undefined;
        await this.context.secrets.delete("session_token");
      }
    }
  }

  async signIn(): Promise<boolean> {
    // Open Clerk sign-in in browser
    const signInUrl = `${this.CLERK_URL}/sign-in`;

    const token = await vscode.window.showInputBox({
      prompt:
        "After signing in, paste your session token here (or press Enter to open sign-in page)",
      placeHolder: "Session token...",
      ignoreFocusOut: true,
    });

    if (!token) {
      // Open browser
      await vscode.env.openExternal(vscode.Uri.parse(signInUrl));
      vscode.window.showInformationMessage(
        "Please sign in through your browser, then restart VS Code",
      );
      return false;
    }

    // Save token
    this.sessionToken = token;
    await this.context.secrets.store("session_token", token);

    try {
      await this.fetchUser();
      return true;
    } catch {
      vscode.window.showErrorMessage("Invalid session token");
      return false;
    }
  }

  async signUp(): Promise<boolean> {
    // Open Clerk sign-up in browser
    const signUpUrl = `${this.CLERK_URL}/sign-up`;
    await vscode.env.openExternal(vscode.Uri.parse(signUpUrl));

    vscode.window.showInformationMessage(
      "Please sign up through your browser, then use Sign In to authenticate",
    );
    return false;
  }

  async signOut(): Promise<void> {
    this.sessionToken = undefined;
    this.user = undefined;
    await this.context.secrets.delete("session_token");
  }

  isAuthenticated(): boolean {
    return !!this.sessionToken && !!this.user;
  }

  getUser(): User | undefined {
    return this.user;
  }

  getUserDisplayName(): string {
    if (!this.user) {
      return "";
    }
    return this.user.firstName || this.user.email.split("@")[0];
  }

  private async fetchUser(): Promise<void> {
    if (!this.sessionToken) {
      throw new Error("No session token");
    }

    const response = await fetch(`${this.API_BASE_URL}/user`, {
      headers: {
        Authorization: `Bearer ${this.sessionToken}`,
      },
    });

    if (!response.ok) {
      throw new Error("Failed to fetch user");
    }

    this.user = (await response.json()) as User;
  }
}
