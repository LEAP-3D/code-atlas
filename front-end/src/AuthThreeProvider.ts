import * as vscode from "vscode";

export class AuthTreeItem extends vscode.TreeItem {
  constructor(
    public readonly label: string,
    public readonly command?: vscode.Command,
    public readonly iconName?: string
  ) {
    super(label, vscode.TreeItemCollapsibleState.None);
    if (iconName) {
      this.iconPath = new vscode.ThemeIcon(iconName);
    }
  }
}

export class AuthTreeProvider implements vscode.TreeDataProvider<AuthTreeItem> {
  private _onDidChangeTreeData = new vscode.EventEmitter<AuthTreeItem | undefined | null | void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private isSignedIn = false;
  private userName = "";

  refresh(signedIn: boolean, userName: string = ""): void {
    this.isSignedIn = signedIn;
    this.userName = userName;
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(element: AuthTreeItem): vscode.TreeItem {
    return element;
  }

  getChildren(): Thenable<AuthTreeItem[]> {
    if (this.isSignedIn) {
      // User is signed in - show user name and sign out button
      const userItem = new AuthTreeItem(
        `👤 ${this.userName}`,
        undefined,
        "account"
      );
      
      const signOutButton = new AuthTreeItem(
        "Sign Out",
        {
          command: "experiment.signOut",
          title: "Sign Out",
        },
        "sign-out"
      );

      return Promise.resolve([userItem, signOutButton]);
    } else {
      // User is not signed in - show sign in/up buttons
      const signInButton = new AuthTreeItem(
        "Sign In",
        {
          command: "experiment.signIn",
          title: "Sign In",
        },
        "sign-in"
      );

      const signUpButton = new AuthTreeItem(
        "Sign Up",
        {
          command: "experiment.signUp",
          title: "Sign Up",
        },
        "add"
      );

      return Promise.resolve([signInButton, signUpButton]);
    }
  }
}