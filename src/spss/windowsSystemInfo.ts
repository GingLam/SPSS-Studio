import { execFile } from 'node:child_process';
import path from 'node:path';
import { promisify } from 'node:util';

const execute = promisify(execFile);

// Read-only Windows queries. Paths are data in environment variables, never script source.
const DISCOVERY_SCRIPT = `
$ErrorActionPreference='SilentlyContinue'
[Console]::OutputEncoding=New-Object System.Text.UTF8Encoding($false)
$roots=New-Object 'System.Collections.Generic.List[string]'
foreach($key in @('HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*','HKLM:\\SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*','HKCU:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*')) {
  Get-ItemProperty $key | Where-Object { $_.DisplayName -match 'SPSS.*Statistics' } | ForEach-Object {
    if($_.InstallLocation) { $roots.Add([string]$_.InstallLocation) }
    if($_.DisplayIcon) { $p=[Environment]::ExpandEnvironmentVariables(([string]$_.DisplayIcon -replace ',\\d+$','').Trim('"')); if(Test-Path -LiteralPath $p -PathType Leaf) { $roots.Add([IO.Path]::GetDirectoryName($p)) } }
  }
}
Get-CimInstance Win32_LogicalDisk -Filter 'DriveType=3' | ForEach-Object {
  $drive=$_.DeviceID+'\\'
  foreach($folder in @('SPSS','IBM','Program Files\\IBM','Program Files (x86)\\IBM')) { $roots.Add((Join-Path $drive $folder)) }
  Get-ChildItem -LiteralPath $drive -Directory | Where-Object { $_.Name -match 'SPSS' } | Select-Object -First 30 | ForEach-Object { $roots.Add($_.FullName) }
}
$shell=New-Object -ComObject WScript.Shell
foreach($menu in @([Environment]::GetFolderPath('StartMenu'),[Environment]::GetFolderPath('CommonStartMenu'))) {
  Get-ChildItem -LiteralPath $menu -Filter '*.lnk' -Recurse | Where-Object { $_.Name -match 'SPSS.*Statistics|Statistics.*SPSS' } | Select-Object -First 30 | ForEach-Object {
    $p=$shell.CreateShortcut($_.FullName).TargetPath
    if($p -and (Test-Path -LiteralPath $p -PathType Leaf)) { $roots.Add([IO.Path]::GetDirectoryName($p)) }
  }
}
ConvertTo-Json -Compress -InputObject @($roots | Select-Object -Unique)
`;

export async function windowsQuery(script: string, environment: NodeJS.ProcessEnv = process.env, signal?: AbortSignal): Promise<string> {
  const executable = path.win32.join(environment.SystemRoot ?? environment.SYSTEMROOT ?? 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  const { stdout } = await execute(executable, ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', script], {
    windowsHide: true,
    timeout: 15_000,
    maxBuffer: 256_000,
    encoding: 'utf8',
    env: environment,
    ...(signal ? { signal } : {}),
  });
  return stdout.replace(/^\uFEFF/u, '').trim();
}

export async function windowsDiscoveryRoots(signal?: AbortSignal): Promise<string[]> {
  const value: unknown = JSON.parse(await windowsQuery(DISCOVERY_SCRIPT, process.env, signal));
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string' && path.win32.isAbsolute(item)).slice(0, 200)
    : [];
}

export async function windowsProductVersions(executables: readonly string[], signal?: AbortSignal): Promise<Record<string, string>> {
  const result: unknown = JSON.parse(await windowsQuery(`
[Console]::OutputEncoding=New-Object System.Text.UTF8Encoding($false)
$result=@{}
foreach($p in (ConvertFrom-Json $env:SPSS_STUDIO_VERSION_PATHS)) {
  $v=(Get-Item -LiteralPath $p -ErrorAction SilentlyContinue).VersionInfo.ProductVersion
  if($v) { $result[$p]=[string]$v }
}
ConvertTo-Json -Compress -InputObject $result
`, { ...process.env, SPSS_STUDIO_VERSION_PATHS: JSON.stringify(executables) }, signal));
  if (typeof result !== 'object' || result === null || Array.isArray(result)) { return {}; }
  return Object.fromEntries(Object.entries(result).filter((item): item is [string, string] => typeof item[1] === 'string'));
}

export async function windowsDesktopDirectory(): Promise<string> {
  return windowsQuery("[Console]::OutputEncoding=New-Object System.Text.UTF8Encoding($false); [Environment]::GetFolderPath('DesktopDirectory')");
}
