import * as vscode from "vscode";

export interface User {
  id: string;
  email: string;
  firstName?: string;
  lastName?: string;
}

export class SimpleAuthService {
  private static instance: SimpleAuthService;
  private user: User | undefined;
  
  private readonly CLERK_URL = "https://proud-horse-28.accounts.dev";

  private constructor(private context: vscode.ExtensionContext) {
    this.loadUser();
  }

  static getInstance(context: vscode.ExtensionContext): SimpleAuthService {
    if (!SimpleAuthService.instance) {
      SimpleAuthService.instance = new SimpleAuthService(context);
    }
    return SimpleAuthService.instance;
  }

  private async loadUser(): Promise<void> {
    const userData = await this.context.globalState.get<User>("user");
    if (userData) {
      this.user = userData;
    }
  }

  async signIn(): Promise<boolean> {
    // Open Clerk sign-in in browser
    const signInUrl = `${this.CLERK_URL}/sign-in?redirect_url=vscode://success`;
    
    vscode.window.showInformationMessage(
      "Opening sign-in page in your browser..."
    );
    
    await vscode.env.openExternal(vscode.Uri.parse(signInUrl));
    
    // Ask user to enter their info after signing in
    const email = await vscode.window.showInputBox({
      prompt: "After signing in, please enter your email address",
      placeHolder: "your.email@example.com",
      ignoreFocusOut: true,
    });

    if (!email) {
      return false;
    }

    const firstName = await vscode.window.showInputBox({
      prompt: "Enter your first name",
      placeHolder: "John",
      ignoreFocusOut: true,
    });

    // Save user info
    this.user = {
      id: Date.now().toString(),
      email: email,
      firstName: firstName || email.split("@")[0],
    };

    await this.context.globalState.update("user", this.user);
    return true;
  }

  async signUp(): Promise<boolean> {
    // Open Clerk sign-up in browser
    const signUpUrl = `${this.CLERK_URL}/sign-up?redirect_url=vscode://success`;
    
    vscode.window.showInformationMessage(
      "Opening sign-up page in your browser..."
    );
    
    await vscode.env.openExternal(vscode.Uri.parse(signUpUrl));
    
    vscode.window.showInformationMessage(
      "After signing up, please use 'Sign In' to complete the process"
    );
    
    return false;
  }

  async signOut(): Promise<void> {
    this.user = undefined;
    await this.context.globalState.update("user", undefined);
  }

  isAuthenticated(): boolean {
    return !!this.user;
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
}