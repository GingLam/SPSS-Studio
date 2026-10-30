import type { ProbeResult } from './runtimeProbe';
import { setupAdvice, setupStrings } from './setupStrings';

export interface SetupReport {
  version: string;
  createdAt: string;
  platform: string;
  vscodeVersion: string;
  success: boolean;
  error?: string;
  advice: string;
  probes: ProbeResult[];
  warnings: string[];
  remoteName?: string;
}

export function redactSetupDiagnostic(text: string): string {
  return text.replace(/Bearer\s+\S+/giu, 'Bearer [redacted]')
    .replace(/\bsk-[A-Za-z0-9_-]{8,}/gu, '[redacted]')
    .replace(/((?:api[_ -]?key|token|password)\s*[:=]\s*)\S+/giu, '$1[redacted]');
}

export function buildSetupReport(report: SetupReport, language: string): string {
  const s = setupStrings(language);
  const lines = [s.reportTitle, `SPSS Studio ${report.version}`, report.createdAt,
    `Platform: ${report.platform} · VS Code ${report.vscodeVersion}`,
    `${s.state}: ${report.success ? s.success : s.failed}`, ''];
  if (report.remoteName) { lines.push(`Remote: ${report.remoteName}`, ''); }
  for (const [index, probe] of report.probes.entries()) {
    lines.push(`${language.startsWith('zh') ? '验证' : 'Check'} ${String(index + 1)} · ${probe.ok ? s.success : s.failed}`);
    lines.push(`${s.installation}: ${probe.installation.installRoot}`,
      `${s.launcher}: ${probe.installation.pythonLauncher}`,
      `${s.version}: ${probe.installation.version ?? 'unknown'}`);
    for (const stage of ['startup', 'analysis', 'data', 'output', 'shutdown'] as const) {
      lines.push(`${probe.passed.includes(stage) ? '✓' : '—'} ${s[stage]}`);
    }
    if (probe.error) { lines.push(`${s.detail}: ${probe.error.slice(0, 1200)}`); }
    if (probe.stage && !probe.ok) { lines.push(`${s.stage}: ${s[probe.stage]}`); }
    const runtime = probe.diagnostics.find((line) => line.includes('SPSS_STUDIO_RUNTIME'));
    if (runtime) { lines.push(`${s.detail}: ${runtime.slice(0, 1200)}`); }
    if (!probe.ok) {
      lines.push(`${s.next}: ${setupAdvice(probe.error ?? '', language)}`);
      for (const diagnostic of [...new Set(probe.diagnostics)].filter((line) => line !== runtime && line !== probe.error).slice(-4)) {
        lines.push(`${s.detail}: ${diagnostic.slice(0, 1200)}`);
      }
    }
    lines.push('');
  }
  if (report.error) { lines.push(`${s.detail}: ${report.error.slice(0, 1200)}`); }
  for (const warning of report.warnings) { lines.push(warning); }
  lines.push('', `${s.next}: ${report.advice}`);
  return redactSetupDiagnostic(lines.join('\n')) + '\n';
}
