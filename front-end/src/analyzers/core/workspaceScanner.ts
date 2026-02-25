import * as vscode from "vscode";

export interface ScannedFile {
  uri: vscode.Uri;
  path: string;
}

export async function scanWorkspaceFiles(
  scopeUri?: vscode.Uri,
): Promise<ScannedFile[]> {
  const files: ScannedFile[] = [];

  if (!vscode.workspace.workspaceFolders) {
    console.error("❌ [scanWorkspaceFiles] No workspace folder open!");
    return files;
  }

  console.log("🔍 [scanWorkspaceFiles] Starting workspace scan...");
  const workspaceRoot = vscode.workspace.workspaceFolders[0].uri.fsPath;
  console.log(`📁 [scanWorkspaceFiles] Workspace root: ${workspaceRoot}`);
  if (scopeUri) {
    console.log(`📍 [scanWorkspaceFiles] Scoped to: ${scopeUri.fsPath}`);
  }

  const allUris = await vscode.workspace.findFiles(
    scopeUri
      ? new vscode.RelativePattern(scopeUri, "**/*.{js,jsx,ts,tsx}")
      : "**/*.{js,jsx,ts,tsx}", // ✅ All JavaScript and TypeScript files
    "**/node_modules/**", // ✅ Exclude node_modules
  );

  console.log(
    `📂 [scanWorkspaceFiles] Found ${allUris.length} total JS/TS files`
  );

  // Count by type before filtering
  const byType = {
    js: allUris.filter((u) => u.fsPath.endsWith(".js")).length,
    jsx: allUris.filter((u) => u.fsPath.endsWith(".jsx")).length,
    ts: allUris.filter((u) => u.fsPath.endsWith(".ts")).length,
    tsx: allUris.filter((u) => u.fsPath.endsWith(".tsx")).length,
  };
  console.log(
    `📊 Breakdown: ${byType.js} .js, ${byType.jsx} .jsx, ${byType.ts} .ts, ${byType.tsx} .tsx`
  );

  // Show ALL files before filtering
  console.log(`\n📋 All ${allUris.length} files found (before filtering):`);
  allUris.forEach((uri, index) => {
    const relativePath = vscode.workspace.asRelativePath(uri);
    console.log(`  ${index + 1}. ${relativePath}`);
  });

  // Now filter out build artifacts
  for (const uri of allUris) {
    const relativePath = vscode.workspace.asRelativePath(uri);
    const normalizedPath = relativePath.replace(/\\/g, "/");

    // Skip build artifacts - be very explicit about what we're checking
    const shouldSkip =
      normalizedPath.includes("/.next/") ||
      normalizedPath.startsWith(".next/") ||
      normalizedPath.includes("/dist/") ||
      normalizedPath.startsWith("dist/") ||
      normalizedPath.includes("/build/") ||
      normalizedPath.startsWith("build/") ||
      normalizedPath.includes("/.turbo/") ||
      normalizedPath.startsWith(".turbo/") ||
      normalizedPath.includes("/out/") ||
      normalizedPath.startsWith("out/") ||
      normalizedPath.includes("/.cache/") ||
      normalizedPath.startsWith(".cache/") ||
      normalizedPath.includes("/coverage/") ||
      normalizedPath.startsWith("coverage/");

    if (shouldSkip) {
      console.log(`  ⏭️  Skipping (build artifact): ${relativePath}`);
      continue;
    }

    console.log(`  ✅ Including: ${relativePath}`);

    files.push({
      uri,
      path: uri.fsPath,
    });
  }

  // Summary
  console.log(
    `\n✅ [scanWorkspaceFiles] Scan complete: ${files.length} files to analyze`
  );

  if (files.length > 0) {
    // Count by type after filtering
    const finalByType = {
      js: files.filter((f) => f.path.endsWith(".js")).length,
      jsx: files.filter((f) => f.path.endsWith(".jsx")).length,
      ts: files.filter((f) => f.path.endsWith(".ts")).length,
      tsx: files.filter((f) => f.path.endsWith(".tsx")).length,
    };
    console.log(
      `📊 Final breakdown: ${finalByType.js} .js, ${finalByType.jsx} .jsx, ${finalByType.ts} .ts, ${finalByType.tsx} .tsx`
    );

    console.log("\n📋 Files that WILL be analyzed:");
    files.forEach((f, index) => {
      const name = vscode.workspace.asRelativePath(f.path);
      console.log(`  ${index + 1}. ${name}`);
    });
  } else {
    console.error("\n❌ CRITICAL: No source files found after filtering!");
    console.error("\n🔍 Debugging info:");
    console.error(`   Workspace: ${workspaceRoot}`);
    console.error(`   Total files scanned: ${allUris.length}`);
    console.error(`   Files after filtering: ${files.length}`);
    console.error(
      `\n   This should NOT happen if you have .js files in src/app/!`
    );
    console.error(`   Please check if VSCode is scanning the correct folder.`);
  }

  return files;
}
