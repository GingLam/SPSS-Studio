export function setupStrings(language: string) {
  return language.toLowerCase().startsWith('zh') ? {
    title: '检测并配置 SPSS', start: '一键检测并配置', chooseFolder: '选择 SPSS 文件夹', cancel: '取消', report: '保存桌面报告',
    introduction: '自动查找本机 SPSS，验证计算能力并保存配置。无需手动修改环境变量。测试使用独立临时数据。',
    ready: '点击“一键检测并配置”开始。', discovery: '正在查找本机 SPSS…', save: '正在保存并验证实际生效的配置…',
    select: '发现多套可用 SPSS，请选择要使用的版本', folderTitle: '选择 IBM SPSS Statistics 安装根目录',
    success: '配置成功，可以运行 .sps 文件。', failed: '配置尚未完成。', cancelled: '已取消，未保留本次配置修改。',
    busy: '已有 SPSS 会话或启动任务。请先保存需要保留的数据，手动执行“SPSS：停止引擎”，再重试配置。',
    untrusted: '请先通过“工作区：管理工作区信任”信任自己的文件夹，再运行配置。',
    remote: '请在本地 Windows 或 Mac 的 VS Code 窗口中配置；WSL、SSH、容器和浏览器窗口不能连接本机 SPSS。',
    missing: '未找到可连接的 SPSS 安装。请点击“选择 SPSS 文件夹”，选择安装目录或其 IBM/SPSS 父目录；若报告提示缺少组件，请用匹配版本的 SPSS 安装程序修复。',
    launcherMissing: '已找到 SPSS 主程序，但缺少 statisticspython3.bat。请用相同版本的 SPSS 安装程序添加或修复 Essentials for Python；单独安装通用 Python 不能替代此组件。',
    executableMissing: '已找到 IBM Python 启动器，但缺少 stats.exe。可能是残留文件或安装不完整，请选择实际安装目录或修复 SPSS。',
    noWorking: '检测到的 SPSS 均未通过验证。请分别查看下面各安装的失败原因；最后一项错误不代表其他安装。',
    override: '工作区设置正在覆盖用户配置。是否仅修复本次所需的 SPSS Studio 路径和自动启动设置？其他设置不变。',
    repair: '修复并继续', unknown: '原因尚不能确定，请保存报告。', retry: '请按上述提示处理后重新检测。',
    startup: '验证 Python 集成与 SPSS 启动', analysis: '执行临时数据统计', data: '核对变量、三行数据及均值 30', output: '检查原生 HTML 统计结果', shutdown: '验证正常关闭',
    reportSaved: '报告已保存', noReport: '请先完成一次检测。', reportTitle: 'SPSS Studio 配置报告',
    reportWriteFailed: '桌面报告尚未保存。请点击“保存桌面报告”，选择可写入的位置。',
    state: '结果', stage: '步骤', installation: '安装位置', launcher: '启动器', version: 'SPSS 版本', detail: '诊断',
    next: '下一步', nextSuccess: '打开 .sps 文件，点击“运行全部”。',
    WINDOWS_DISCOVERY_PARTIAL: '部分 Windows 安装线索无法读取或有界磁盘扫描未完成；其他检测结果仍有效。可用“选择 SPSS 文件夹”指定任意盘符的实际安装目录。',
    WINDOWS_VERSION_UNKNOWN: '无法读取程序补丁版本；以实际运行测试判断可用性。',
    WINDOWS_POWERSHELL_UNAVAILABLE: 'PowerShell 安装线索不可用；继续使用独立磁盘检测与其他线索。',
    WINDOWS_REGISTRY_UNAVAILABLE: '部分注册表线索不可用；继续检查磁盘目录与其他安装线索。',
    importFailed: 'IBM Python 集成无法导入。请使用匹配版本的官方 SPSS 安装程序修复组件。',
    licenseFailed: 'SPSS 启动返回授权相关错误。请检查许可证或学校的许可证服务器。',
    bridgeCompatibility: 'SPSS Python 无法解析插件桥接脚本，这是插件与 Python 版本的兼容问题。请安装 SPSS Studio 1.4.3 或更新版本后重试；无需手动修改环境变量或另装 Python。',
    backendFailed: 'IBM Python 已响应，但 SPSS 后台引擎未就绪。此信息不足以确认授权故障；请查看本次诊断，检查匹配版本的 Python 集成、SPSS 安装及授权。',
    launchFailed: '无法运行 IBM Python 启动器或其 Python 程序。请查看诊断中的缺失文件，并用匹配版本的 SPSS 安装程序修复 Python 集成。',
    timeout: '等待 SPSS 超时。请检查授权、启动拦截或磁盘状况；必要时增加启动等待时间。',
    rollback: '恢复旧配置时遇到问题。请保留报告并检查 SPSS Studio 设置。',
    percentPath: 'SPSS 或 VS Code 扩展路径含百分号（%），IBM 批处理会再次展开它。请使用不含百分号的安装/扩展路径后重试。',
    lockUnavailable: '本机配置通道暂不可用。请关闭其他配置窗口后重试；若仍失败，请保存报告。',
    armWindows: '检测到 ARM64 Windows 线索。IBM 不正式支持此平台的 SPSS 客户端；本次仍尝试实际验证，通过也不等于 IBM 官方兼容认证。',
    blocked: 'Windows 拒绝启动配置工具或 SPSS 组件。请检查文件权限、安全软件拦截记录及单位的应用控制策略，并保留原始错误。',
    architecture: 'Windows 无法运行此程序的架构或可执行文件。请核对报告中的系统、进程架构及 SPSS 安装版本；Windows ARM 或不完整的安装不能通过修改路径解决。',
  } : {
    title: 'Detect and Configure SPSS', start: 'Detect and Configure', chooseFolder: 'Choose SPSS Folder', cancel: 'Cancel', report: 'Save Desktop Report',
    introduction: 'Find local SPSS, test its calculation engine, and save working settings. No manual environment-variable editing. Tests use separate temporary data.',
    ready: 'Select Detect and Configure to begin.', discovery: 'Finding local SPSS…', save: 'Saving and verifying effective settings…',
    select: 'Multiple working SPSS installations: select one', folderTitle: 'Select the IBM SPSS Statistics installation root',
    success: 'Configuration passed. You can run .sps files.', failed: 'Configuration is incomplete.', cancelled: 'Cancelled. Setup changes were not retained.',
    busy: 'An SPSS session or startup is active. Save any data you need, run SPSS: Stop Engine manually, then retry setup.',
    untrusted: 'Trust your own folder using Workspaces: Manage Workspace Trust before running setup.',
    remote: 'Use a local Windows or Mac VS Code window. WSL, SSH, containers, and browser windows cannot use local SPSS.',
    missing: 'No connectable SPSS installation found. Use Choose SPSS Folder to select its installation or IBM/SPSS parent folder. Repair any missing components reported below with the matching SPSS installer.',
    launcherMissing: 'SPSS was found, but statisticspython3.bat is missing. Add or repair Essentials for Python using the matching SPSS installer; a generic Python installation cannot replace it.',
    executableMissing: 'The IBM Python launcher was found, but stats.exe is missing. These may be residual files or an incomplete installation. Choose the actual installation or repair SPSS.',
    noWorking: 'None of the detected SPSS installations passed. Review each installation’s failure below; the last error does not describe the others.',
    override: 'Workspace settings override user settings. Repair only the required SPSS Studio paths and auto-start settings?',
    repair: 'Repair and Continue', unknown: 'The cause is not confirmed. Save the report for review.', retry: 'Resolve the issue above, then retry.',
    startup: 'Verify Python integration and SPSS startup', analysis: 'Calculate with temporary data', data: 'Check variables, three rows, and mean 30', output: 'Check native HTML results', shutdown: 'Verify graceful shutdown',
    reportSaved: 'Report saved', noReport: 'Complete a detection first.', reportTitle: 'SPSS Studio Setup Report',
    reportWriteFailed: 'The desktop report was not saved. Use Save Desktop Report to choose a writable location.',
    state: 'Result', stage: 'Stage', installation: 'Installation', launcher: 'Launcher', version: 'SPSS version', detail: 'Diagnostics',
    next: 'Next', nextSuccess: 'Open an .sps file and select Run All.',
    WINDOWS_DISCOVERY_PARTIAL: 'Some Windows hints were unavailable or the bounded disk scan was incomplete. Other results remain valid. Use Choose SPSS Folder to select the actual installation on any drive.',
    WINDOWS_VERSION_UNKNOWN: 'Executable patch version is unavailable; actual runtime tests determine compatibility.',
    WINDOWS_POWERSHELL_UNAVAILABLE: 'PowerShell installation hints are unavailable; independent disk detection and other hints remain in use.',
    WINDOWS_REGISTRY_UNAVAILABLE: 'Some registry hints are unavailable; disk directories and other installation hints remain in use.',
    importFailed: 'IBM Python integration cannot be imported. Repair it with the matching official SPSS installer.',
    licenseFailed: 'SPSS reported a licensing error. Check the license or your institution’s license server.',
    bridgeCompatibility: 'SPSS Python cannot parse the extension bridge script: an extension/Python compatibility problem. Install SPSS Studio 1.4.3 or newer and retry; no manual environment changes or separate Python installation are needed.',
    backendFailed: 'IBM Python responded, but the SPSS backend is not ready. This alone does not confirm a licensing failure. Review the diagnostics and check version-matched Python integration, SPSS installation, and licensing.',
    launchFailed: 'The IBM Python launcher or its Python executable could not run. Check the missing file in the diagnostics and repair Python integration with the matching SPSS installer.',
    timeout: 'SPSS timed out. Check licensing, application blocking, or disk performance; increase the startup timeout if necessary.',
    rollback: 'Restoring prior settings failed. Keep this report and inspect SPSS Studio settings.',
    percentPath: 'The SPSS or VS Code extension path contains %. IBM batch CALL expands this character. Use installation/extension paths without percent signs.',
    lockUnavailable: 'The local setup channel is unavailable. Close other setup windows and retry; save the report if it persists.',
    armWindows: 'ARM64 Windows hints detected. IBM does not officially support SPSS clients on this platform. Setup will still attempt real verification; a pass is not IBM compatibility certification.',
    blocked: 'Windows denied launching a setup tool or SPSS component. Check file permissions, application-blocking records, and institutional application-control policies. Keep the original error.',
    architecture: 'Windows cannot run this executable or architecture. Check the OS/process architecture in the report and the SPSS installation. Path changes cannot resolve Windows ARM limitations or incomplete binaries.',
  };
}

export function setupAdvice(error: string, language: string): string {
  const s = setupStrings(language);
  if (/SETUP_ENGINE_BUSY/u.test(error)) { return s.busy; }
  if (/SETUP_LOCK_UNAVAILABLE/u.test(error)) { return s.lockUnavailable; }
  if (/SETUP_ROLLBACK_FAILED/u.test(error)) { return s.rollback; }
  if (/SETUP_CANCELLED/u.test(error)) { return s.cancelled; }
  if (/SETUP_NOT_FOUND/u.test(error)) { return s.missing; }
  if (/SETUP_NO_WORKING_INSTALLATION/u.test(error)) { return s.noWorking; }
  if (/literal %/u.test(error)) { return s.percentPath; }
  if (/SyntaxError/iu.test(error) && /spss_bridge\.py/iu.test(error)) { return s.bridgeCompatibility; }
  if (/\b(?:EACCES|EPERM)\b|access is denied|拒绝访问|blocked by (?:group policy|your administrator)|此程序被组策略阻止/iu.test(error)) { return s.blocked; }
  if (/not a valid Win32|不是有效的 Win32|incompatible with (?:the )?version of Windows|\bERROR_BAD_EXE_FORMAT\b/iu.test(error)) { return s.architecture; }
  if (/not recognized|不是内部|ENOENT|cannot find (?:the )?(?:file|path)|系统找不到指定/iu.test(error)) { return s.launchFailed; }
  if (/Unable to import|No module named|DLL load/iu.test(error)) { return s.importFailed; }
  // A directory called "license" is not licensing evidence.
  const evidence = error.replace(/["'][A-Za-z]:[\\/][^"'\r\n]*["']/gu, '[path]')
    .replace(/[A-Za-z]:[\\/][^\s"'<>|\r\n]*/gu, '[path]');
  if (/\b(?:no|invalid|expired|missing|unavailable)\s+(?:valid\s+)?licen[cs]es?\b|\bnot licen[cs]ed\b|\blicen[cs](?:e|ing)(?:\s+|:\s*)[^\r\n]{0,80}(?:error|fail|invalid|expir|not found|not available|unavailable|denied|cannot|could not)|(?:cannot|could not|unable to|failed to)\s+(?:obtain|acquire|check(?: ?out)?|find|validate|verify|renew|use)\s+(?:(?:a|an|the|valid)\s+)*licen[cs]e\b|(?:unanticipated|unexpected) problem with (?:the )?licen[cs]e|(?:许可证|授权)[^\r\n]{0,40}(?:错误|失败|无效|过期|不可用|未找到)/iu.test(evidence)) { return s.licenseFailed; }
  if (/backend is not ready|后台.*未就绪/iu.test(error)) { return s.backendFailed; }
  if (/timed out/iu.test(error)) { return s.timeout; }
  return s.unknown;
}
