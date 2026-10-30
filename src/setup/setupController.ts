import * as vscode from 'vscode';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { randomBytes } from 'node:crypto';
import type { EngineService, SpssRuntimeConfiguration } from '../spss/engineService';
import { locateSpss } from '../spss/spssLocator';
import { windowsDesktopDirectory } from '../spss/windowsSystemInfo';
import { hasWindowsArmHint, setupHostInfo } from '../spss/windowsEnvironment';
import { windowsDiskDiscovery } from '../spss/windowsDiskDiscovery';
import { discoverRuntime } from './discovery';
import { probeRuntime, type ProbeResult } from './runtimeProbe';
import { configureTransaction, type ConfigurationEdit } from './configurationTransaction';
import { setupStrings, setupAdvice } from './setupStrings';
import { buildSetupReport, redactSetupDiagnostic, type SetupReport } from './setupReport';
import { acquireSetupLock } from './setupLock';

function escape(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
}

export function isSetupMessage(value: unknown): value is { type: 'start' | 'choose' | 'cancel' | 'report' } {
  return typeof value === 'object' && value !== null && 'type' in value
    && typeof value.type === 'string' && ['start', 'choose', 'cancel', 'report'].includes(value.type);
}

export class SetupController implements vscode.Disposable {
  private panel: vscode.WebviewPanel | undefined;
  private abortController: AbortController | undefined;
  private report: SetupReport | undefined;
  private reportPath = '';
  private task: Promise<void> | undefined;
  private readonly recovery: Promise<void>;
  private finishing = false;
  private readonly lines: string[] = [];
  private readonly s = setupStrings(vscode.env.language);

  public constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly engine: EngineService,
    private readonly configuration: () => SpssRuntimeConfiguration,
    private readonly output: vscode.OutputChannel,
  ) {
    this.recovery = this.recoverInterrupted();
    void this.recovery.catch(() => undefined);
  }

  public get summary(): { success: boolean; error?: string; stages: string[] } | undefined {
    const report = this.report;
    return report ? { success: report.success, ...(report.error ? { error: report.error } : {}), stages: report.probes.at(-1)?.passed ?? [] } : undefined;
  }

  public show(): void {
    if (this.panel) { this.panel.reveal(); return; }
    this.panel = vscode.window.createWebviewPanel('spssStudio.setup', this.s.title, vscode.ViewColumn.Active, {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this.context.extensionUri, 'media')],
    });
    this.panel.onDidDispose(() => { this.abortController?.abort(); this.panel = undefined; });
    this.panel.webview.onDidReceiveMessage((message: unknown) => {
      if (!isSetupMessage(message)) { return; }
      if (message.type === 'cancel' && !this.finishing) { this.abortController?.abort(); }
      if (message.type === 'start') { void this.run(); }
      if (message.type === 'choose') { void this.chooseAndRun(); }
      if (message.type === 'report') { void this.saveReport(true); }
    });
    this.render();
  }

  private render(): void {
    if (!this.panel) { return; }
    const nonce = randomBytes(18).toString('base64url');
    const style = this.panel.webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'media', 'quick-start.css'));
    const script = this.panel.webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'media', 'runtime-setup.js'));
    const busy = !!this.abortController;
    this.panel.webview.html = `<!doctype html><html lang="${vscode.env.language.startsWith('zh') ? 'zh-CN' : 'en'}"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${this.panel.webview.cspSource}; script-src 'nonce-${nonce}'">
<link rel="stylesheet" href="${style.toString()}"><title>${escape(this.s.title)}</title></head><body><main>
<header class="hero"><div class="eyebrow">SPSS Studio ${escape((this.context.extension.packageJSON as { version: string }).version)}</div><h1>${escape(this.s.title)}</h1><p>${escape(this.s.introduction)}</p></header>
<section class="setup-actions"><button data-action="start" ${busy ? 'disabled' : ''}>${escape(this.s.start)}</button>
<button data-action="choose" ${busy ? 'disabled' : ''}>${escape(this.s.chooseFolder)}</button>
<button data-action="cancel" ${busy && !this.finishing ? '' : 'disabled'}>${escape(this.s.cancel)}</button>
<button data-action="report" ${!this.report || busy ? 'disabled' : ''}>${escape(this.s.report)}</button></section>
<section role="status" aria-live="polite">${this.lines.length ? this.lines.map((line) => `<p>${escape(redactSetupDiagnostic(line))}</p>`).join('') : `<p>${escape(this.s.ready)}</p>`}</section>
${this.report ? `<section><h2>${escape(this.report.success ? this.s.success : this.s.failed)}</h2><p>${escape(this.report.advice)}</p></section>` : ''}
${this.reportPath ? `<p>${escape(this.s.reportSaved)}: ${escape(this.reportPath)}</p>` : ''}
</main><script nonce="${nonce}" src="${script.toString()}"></script></body></html>`;
  }

  private log(message: string): void {
    this.lines.push(message);
    this.output.appendLine(`[Setup] ${redactSetupDiagnostic(message)}`);
    this.render();
  }

  private async chooseAndRun(): Promise<void> {
    if (this.abortController) { return; }
    const folders = await vscode.window.showOpenDialog({ canSelectFiles: false, canSelectFolders: true, canSelectMany: false, title: this.s.folderTitle });
    if (folders?.[0]) { await this.run(folders[0].fsPath); }
  }

  public run(manualRoot?: string): Promise<void> {
    // Quick Start and programmatic entry points must reveal progress too.
    this.show();
    if (this.task) { return this.task; }
    const task = this.performRun(manualRoot);
    this.task = task;
    const clear = (): void => { if (this.task === task) { this.task = undefined; } };
    void task.then(clear, clear);
    return task;
  }

  private async performRun(manualRoot?: string): Promise<void> {
    if (this.abortController) { return; }
    this.show();
    const controller = new AbortController();
    this.abortController = controller;
    this.finishing = false;
    this.reportPath = '';
    this.lines.length = 0;
    this.report = undefined;
    const report: SetupReport = {
      version: (this.context.extension.packageJSON as { version: string }).version,
      createdAt: new Date().toISOString(), platform: process.platform, vscodeVersion: vscode.version,
      success: false, advice: this.s.retry, probes: [], warnings: [],
      host: setupHostInfo(),
      ...(vscode.env.remoteName ? { remoteName: vscode.env.remoteName } : {}),
    };
    let release: (() => void) | undefined;
    let releaseLock: (() => Promise<void>) | undefined;
    try {
      await this.recovery.catch(() => undefined);
      await this.recoverInterrupted();
      if (!vscode.workspace.isTrusted) { throw new Error(this.s.untrusted); }
      if (vscode.env.remoteName || !['win32', 'darwin'].includes(process.platform)) { throw new Error(this.s.remote); }
      if ((vscode.workspace.workspaceFolders?.length ?? 0) > 1) {
        throw new Error(vscode.env.language.startsWith('zh') ? '请在新窗口中打开单个文件夹后配置，避免多根工作区设置冲突。' : 'Open a single folder in a new window before setup to avoid multi-root setting conflicts.');
      }
      release = this.engine.reserveForSetup();
      releaseLock = await acquireSetupLock(this.context.globalStorageUri.fsPath);
      this.log(this.s.discovery);
      const config = this.configuration();
      const options = { explicitInstallPath: config.installPath, explicitPythonLauncherPath: config.pythonLauncherPath };
      const found = await discoverRuntime(options, manualRoot, controller.signal);
      report.warnings = found.warnings.map((warning) => warning in this.s ? this.s[warning as keyof typeof this.s] : warning);
      if (process.platform === 'win32' && report.host && hasWindowsArmHint(report.host)) {
        report.warnings.push(this.s.armWindows);
        this.log(this.s.armWindows);
      }
      for (const issue of found.issues ?? []) {
        const message = `${issue.installRoot}: ${issue.missing === 'launcher' ? this.s.launcherMissing : this.s.executableMissing}`;
        report.warnings.push(message);
        this.log(message);
      }
      controller.signal.throwIfAborted();
      if (!found.installations.length) { throw new Error('SETUP_NOT_FOUND'); }
      const usable: ProbeResult[] = [];
      for (const candidate of found.installations.slice(0, 8)) {
        controller.signal.throwIfAborted();
        this.log(candidate.installRoot);
        const tested = await this.probe(candidate, controller.signal);
        report.probes.push(tested);
        if (tested.ok) { usable.push(tested); }
        else {
          this.log(setupAdvice(tested.error ?? '', vscode.env.language));
          if (tested.error) { this.log(tested.error); }
        }
      }
      controller.signal.throwIfAborted();
      if (!usable.length) { throw new Error('SETUP_NO_WORKING_INSTALLATION'); }
      const selected = usable.length === 1 ? usable[0] : await this.selectInstallation(usable, controller.signal);
      if (!selected) { throw new Error('SETUP_CANCELLED'); }
      controller.signal.throwIfAborted();
      this.log(this.s.save);
      const edits = await this.configurationEdits(selected.installation.installRoot, selected.installation.pythonLauncher);
      controller.signal.throwIfAborted();
      await this.context.globalState.update('runtimeSetup.previousConfiguration', {
        createdAt: report.createdAt,
        edits: edits.map((edit) => ({ ...edit, beforeDefined: edit.before !== undefined, before: edit.before ?? null })),
      });
      const journal = {
        ownerPid: process.pid,
        workspace: this.workspaceIdentity(),
        edits: edits.map((edit) => ({ ...edit, beforeDefined: edit.before !== undefined, before: edit.before ?? null })),
      };
      await this.context.globalState.update('runtimeSetup.pendingTransaction', journal);
      let rollbackFailed = false;
      try {
      await configureTransaction(edits, async (edit, value) => {
        const settings = vscode.workspace.getConfiguration('spssStudio');
        const target = edit.target === 'global' ? vscode.ConfigurationTarget.Global : edit.target === 'workspace' ? vscode.ConfigurationTarget.Workspace : vscode.ConfigurationTarget.WorkspaceFolder;
        await settings.update(edit.key, value, target);
      }, async () => {
        controller.signal.throwIfAborted();
        const effective = this.configuration();
        if (effective.installPath !== selected.installation.installRoot || effective.pythonLauncherPath !== selected.installation.pythonLauncher || !effective.autoStart) {
          throw new Error('SETUP_EFFECTIVE_CONFIGURATION_MISMATCH');
        }
        const actual = process.platform === 'win32'
          ? (await windowsDiskDiscovery(controller.signal, { roots: [effective.installPath] })).installations.find((item) => (
            item.installRoot.toLowerCase() === effective.installPath.toLowerCase()
            && item.pythonLauncher.toLowerCase() === effective.pythonLauncherPath.toLowerCase()
          ))
          : await locateSpss({ options: { explicitInstallPath: effective.installPath, explicitPythonLauncherPath: effective.pythonLauncherPath } });
        if (!actual) { throw new Error('SETUP_EFFECTIVE_CONFIGURATION_MISMATCH'); }
        if (!actual.version && selected.installation.version) { actual.version = selected.installation.version; }
        const final = await this.probe(actual, controller.signal);
        report.probes.push(final);
        controller.signal.throwIfAborted();
        if (!final.ok) { throw new Error(final.error ?? 'SETUP_FINAL_VERIFICATION_FAILED'); }
        const saved = this.configuration();
        if (saved.installPath !== selected.installation.installRoot || saved.pythonLauncherPath !== selected.installation.pythonLauncher || !saved.autoStart) {
          throw new Error('SETUP_EFFECTIVE_CONFIGURATION_MISMATCH');
        }
        this.finishing = true;
        this.render();
        await this.context.globalState.update('runtimeSetup.pendingTransaction', { ...journal, committed: true });
      }, (edit) => this.settingValue(edit));
      } catch (error) {
        rollbackFailed = error instanceof Error && error.message.includes('SETUP_ROLLBACK_FAILED');
        throw error;
      } finally {
        if (!rollbackFailed) {
          try { await this.context.globalState.update('runtimeSetup.pendingTransaction', undefined); }
          catch { report.warnings.push('Setup journal cleanup deferred until the next activation.'); }
        }
      }
      this.engine.completeSetup(selected.installation);
      report.success = true;
      report.advice = this.s.nextSuccess;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      report.error = message.includes('SETUP_ROLLBACK_FAILED') ? message : controller.signal.aborted ? 'SETUP_CANCELLED' : message;
      const advice = setupAdvice(report.error, vscode.env.language);
      report.advice = advice === this.s.unknown && report.error !== 'SETUP_CANCELLED' ? `${report.error}\n${advice}` : advice;
      this.log(report.advice);
    } finally {
      await releaseLock?.();
      release?.();
      this.report = report;
      try {
        await vscode.workspace.fs.createDirectory(this.context.globalStorageUri);
        await vscode.workspace.fs.writeFile(vscode.Uri.joinPath(this.context.globalStorageUri, 'runtime-setup-details.log'), Buffer.from(
          redactSetupDiagnostic(report.probes.flatMap((probe) => [probe.installation.installRoot, ...probe.diagnostics]).join('\n')).slice(0, 64_000), 'utf8',
        ));
      } catch { /* A report/log write failure must not invalidate a completed runtime check. */ }
      if (process.platform === 'win32' && !vscode.env.remoteName) { await this.saveReport(false); }
      this.abortController = undefined;
      this.render();
    }
  }

  private workspaceIdentity(): string {
    return vscode.workspace.workspaceFile?.toString() ?? vscode.workspace.workspaceFolders?.[0]?.uri.toString() ?? '';
  }

  private settingValue(edit: ConfigurationEdit): unknown {
    const values = vscode.workspace.getConfiguration('spssStudio').inspect<unknown>(edit.key);
    return edit.target === 'global' ? values?.globalValue : edit.target === 'workspace' ? values?.workspaceValue : values?.workspaceFolderValue;
  }

  private async recoverInterrupted(): Promise<void> {
    const pending = this.context.globalState.get<{ committed?: boolean; ownerPid?: number; workspace: string; edits: Array<ConfigurationEdit & { beforeDefined: boolean }> }>('runtimeSetup.pendingTransaction');
    if (!pending || !Array.isArray(pending.edits)) { return; }
    if (pending.committed) {
      try { await this.context.globalState.update('runtimeSetup.pendingTransaction', undefined); }
      catch { /* Committed settings must not be rolled back if journal removal is unavailable. */ }
      return;
    }
    if (pending.ownerPid && pending.ownerPid !== process.pid && Number.isSafeInteger(pending.ownerPid) && pending.ownerPid > 0) {
      let alive: boolean;
      try { process.kill(pending.ownerPid, 0); alive = true; }
      catch (error) { alive = error instanceof Error && 'code' in error && error.code === 'EPERM'; }
      if (alive) { throw new Error('SETUP_ENGINE_BUSY'); }
    }
    const release = this.engine.reserveForSetup();
    let releaseLock: (() => Promise<void>) | undefined;
    try {
    releaseLock = await acquireSetupLock(this.context.globalStorageUri.fsPath);
    const failures: string[] = [];
    for (const edit of [...pending.edits].reverse()) {
      if (!['installPath', 'pythonLauncherPath', 'autoStart'].includes(edit.key) || !['global', 'workspace', 'folder'].includes(edit.target)) { continue; }
      if (edit.target !== 'global' && pending.workspace !== this.workspaceIdentity()) { failures.push(edit.key); continue; }
      const before = edit.beforeDefined ? edit.before : undefined;
      if (this.settingValue(edit) === before) { continue; }
      if (this.settingValue(edit) !== edit.after) { failures.push(edit.key); continue; }
      try {
        const target = edit.target === 'global' ? vscode.ConfigurationTarget.Global : edit.target === 'workspace' ? vscode.ConfigurationTarget.Workspace : vscode.ConfigurationTarget.WorkspaceFolder;
        await vscode.workspace.getConfiguration('spssStudio').update(edit.key, before, target);
      } catch { failures.push(edit.key); }
    }
    if (failures.length) {
      void vscode.window.showWarningMessage(`${this.s.rollback} ${failures.join(', ')}`);
      throw new Error(`SETUP_ROLLBACK_FAILED ${failures.join(', ')}`);
    }
    await this.context.globalState.update('runtimeSetup.pendingTransaction', undefined);
    } finally { await releaseLock?.(); release(); }
  }

  public async cancelAndWait(): Promise<void> {
    this.abortController?.abort();
    await this.task;
  }

  private probe(installation: ProbeResult['installation'], signal: AbortSignal): Promise<ProbeResult> {
    return probeRuntime(installation, path.join(this.context.extensionPath, 'resources', 'bridge', 'spss_bridge.py'), this.configuration(), signal, (stage) => this.log(this.s[stage]));
  }

  private async selectInstallation(usable: ProbeResult[], signal: AbortSignal): Promise<ProbeResult | undefined> {
    const cancellation = new vscode.CancellationTokenSource();
    const cancel = (): void => cancellation.cancel();
    signal.addEventListener('abort', cancel, { once: true });
    try {
      if (signal.aborted) { return undefined; }
      return (await vscode.window.showQuickPick(
        usable.map((probe) => ({ label: `SPSS ${probe.installation.version ?? '?'}`, description: probe.installation.installRoot, probe })),
        { placeHolder: this.s.select }, cancellation.token,
      ))?.probe;
    } finally { signal.removeEventListener('abort', cancel); cancellation.dispose(); }
  }

  private async configurationEdits(root: string, launcher: string): Promise<ConfigurationEdit[]> {
    const settings = vscode.workspace.getConfiguration('spssStudio');
    const desired: Record<string, string | boolean> = { installPath: root, pythonLauncherPath: launcher, autoStart: true };
    const edits: ConfigurationEdit[] = [];
    for (const [key, after] of Object.entries(desired)) {
      const values = settings.inspect<unknown>(key);
      if (values?.globalValue !== after) { edits.push({ key, target: 'global', before: values?.globalValue, after }); }
      if (values?.workspaceValue !== undefined && values.workspaceValue !== after) {
        edits.push({ key, target: 'workspace', before: values.workspaceValue, after });
      }
      if (values?.workspaceFolderValue !== undefined && values.workspaceFolderValue !== after) {
        edits.push({ key, target: 'folder', before: values.workspaceFolderValue, after });
      }
    }
    if (edits.some((edit) => edit.target !== 'global')) {
      const answer = await vscode.window.showWarningMessage(this.s.override, { modal: true }, this.s.repair);
      if (answer !== this.s.repair) { throw new Error('SETUP_CANCELLED'); }
    }
    return edits;
  }

  private async saveReport(interactive: boolean): Promise<void> {
    if (!this.report) { return; }
    const name = `SPSS-Studio-Setup-${new Date().toISOString().replace(/[:.]/gu, '-')}.txt`;
    let destination: vscode.Uri | undefined;
    try {
      const desktop = process.platform === 'win32' ? await windowsDesktopDirectory() : path.join(os.homedir(), 'Desktop');
      if (!path.isAbsolute(desktop)) { throw new Error('Desktop unavailable'); }
      await fs.access(desktop);
      destination = vscode.Uri.file(path.join(desktop, name));
      await vscode.workspace.fs.writeFile(destination, Buffer.from(buildSetupReport(this.report, vscode.env.language), 'utf8'));
    } catch {
      destination = undefined;
      this.log(this.s.reportWriteFailed);
      if (interactive) {
        destination = await vscode.window.showSaveDialog({ defaultUri: vscode.Uri.file(path.join(os.homedir(), name)), filters: { Text: ['txt'] } });
        if (destination) {
          try { await vscode.workspace.fs.writeFile(destination, Buffer.from(buildSetupReport(this.report, vscode.env.language), 'utf8')); }
          catch (error) { void vscode.window.showErrorMessage(String(error)); destination = undefined; }
        }
      }
    }
    if (destination) { this.reportPath = destination.fsPath; }
    this.render();
  }

  public dispose(): void { this.abortController?.abort(); this.panel?.dispose(); }
}
