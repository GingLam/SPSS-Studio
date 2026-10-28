import type { ProbeResult } from './runtimeProbe';
import { setupStrings } from './setupStrings';

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
  const latest = report.probes.at(-1);
  for (const probe of latest ? [latest] : []) {
    lines.push(`${s.installation}: ${probe.installation.installRoot}`,
      `${s.launcher}: ${probe.installation.pythonLauncher}`,
      `${s.version}: ${probe.installation.version ?? 'unknown'}`);
    for (const stage of ['startup', 'analysis', 'data', 'output', 'shutdown'] as const) {
      lines.push(`${probe.passed.includes(stage) ? '✓' : '—'} ${s[stage]}`);
    }
    if (probe.error) { lines.push(`${s.detail}: ${probe.error.slice(0, 1200)}`); }
    lines.push('');
  }
  if (report.probes.length > 1) {
    lines.push(language.startsWith('zh') ? `已完成 ${String(report.probes.length)} 次独立验证；详细记录保存在插件本地日志中。` : `${String(report.probes.length)} isolated checks completed; details are in the extension's local log.`);
  }
  if (report.error) { lines.push(`${s.detail}: ${report.error.slice(0, 1200)}`); }
  for (const warning of report.warnings) { lines.push(warning); }
  lines.push('', `${s.next}: ${report.advice}`);
  return redactSetupDiagnostic(lines.join('\n')) + '\n';
}
