import * as vscode from "vscode";
import * as http from "http";

export interface User {
  id: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
  imageUrl: string;
}

class AuthService {
  private static instance: AuthService;
  private sessionToken: string | null = null;
  private user: User | null = null;
  private context: vscode.ExtensionContext | null = null;

  private constructor() {}

  static getInstance(): AuthService {
    if (!AuthService.instance) {
      AuthService.instance = new AuthService();
    }
    return AuthService.instance;
  }

  initialize(context: vscode.ExtensionContext) {
    this.context = context;
    this.loadSession();
  }

  private async loadSession() {
    if (!this.context) return;

    const savedToken = await this.context.secrets.get("clerk_session_token");
    if (savedToken) {
      this.sessionToken = savedToken;
      await this.fetchUser();
    }
  }

  async login(): Promise<boolean> {
    try {
      // Open Clerk sign-in URL in browser
      const clerkSignInUrl = `https://proud-horse-28.clerk.accounts.dev`;

      const uri = vscode.Uri.parse(clerkSignInUrl);
      await vscode.env.openExternal(uri);

      // Wait for callback (you'll need to implement URI handler)
      vscode.window.showInformationMessage(
        "Please complete sign-in in your browser...",
      );

      return true;
    } catch (error) {
      console.error("Login error:", error);
      vscode.window.showErrorMessage("Failed to initiate login");
      return false;
    }
  }

  async handleAuthCallback(token: string) {
    if (!this.context) return false;

    this.sessionToken = token;
    await this.context.secrets.store("clerk_session_token", token);

    const success = await this.fetchUser();
    if (success) {
      vscode.window.showInformationMessage(`Welcome, ${this.user?.email}!`);
    }

    return success;
  }

  private async fetchUser(): Promise<boolean> {
    if (!this.sessionToken) return false;

    return new Promise((resolve) => {
      const options = {
        hostname: "localhost",
        port: 3001,
        path: "/api/auth/user",
        method: "GET",
        headers: {
          Authorization: `Bearer ${this.sessionToken}`,
        },
      };

      const req = http.request(options, (res) => {
        let data = "";

        res.on("data", (chunk) => {
          data += chunk;
        });

        res.on("end", () => {
          try {
            if (res.statusCode === 200) {
              this.user = JSON.parse(data) as User;
              resolve(true);
            } else {
              console.error("Failed to fetch user:", res.statusCode);
              this.sessionToken = null;
              this.user = null;
              resolve(false);
            }
          } catch (error) {
            console.error("Fetch user error:", error);
            this.sessionToken = null;
            this.user = null;
            resolve(false);
          }
        });
      });

      req.on("error", (error) => {
        console.error("Fetch user error:", error);
        this.sessionToken = null;
        this.user = null;
        resolve(false);
      });

      req.end();
    });
  }

  async logout() {
    if (!this.context) return;

    this.sessionToken = null;
    this.user = null;
    await this.context.secrets.delete("clerk_session_token");

    vscode.window.showInformationMessage("Logged out successfully");
  }

  isAuthenticated(): boolean {
    return this.sessionToken !== null && this.user !== null;
  }

  getUser(): User | null {
    return this.user;
  }

  getToken(): string | null {
    return this.sessionToken;
  }
}

export const authService = AuthService.getInstance();
