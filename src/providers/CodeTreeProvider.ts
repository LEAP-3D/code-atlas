import * as vscode from "vscode";

export class CodeTreeProvider implements vscode.TreeDataProvider<TreeItem> {
  private _onDidChangeTreeData = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  refresh() {
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(element: TreeItem): vscode.TreeItem {
    return element;
  }

  // getChildren(): TreeItem[] {
  //   return [
  //     new TreeItem("Explain Selected Code", "experiment.showSelectedCode"),
  //     new TreeItem("Show Execution Flow", "experiment.showSelectedCode"),
  //   ];
  // }
  getChildren(): TreeItem[] {
    return [
      new TreeItem("🧠 Roadmap View", "experiment.showRoadmap"),
      new TreeItem("🐞 Debug Execution Flow", "experiment.showSelectedCode"),
    ];
  }
}

class TreeItem extends vscode.TreeItem {
  constructor(label: string, commandName: string) {
    super(label, vscode.TreeItemCollapsibleState.None);
    this.command = {
      command: commandName,
      title: label,
    };
  }
}
