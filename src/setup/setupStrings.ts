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
    missing: '未找到完整的 IBM launcher 和 SPSS 安装。请选择 SPSS 安装文件夹，或修复 SPSS 安装后重试。',
    override: '工作区设置正在覆盖用户配置。是否仅修复本次所需的 SPSS Studio 路径和自动启动设置？其他设置不变。',
    repair: '修复并继续', unknown: '原因尚不能确定，请保存报告。', retry: '请按上述提示处理后重新检测。',
    startup: '验证 Python 集成与 SPSS 启动', analysis: '执行临时数据统计', data: '核对变量、三行数据及均值 30', output: '检查原生 HTML 统计结果', shutdown: '验证正常关闭',
    reportSaved: '报告已保存', noReport: '请先完成一次检测。', reportTitle: 'SPSS Studio 配置报告',
    reportWriteFailed: '桌面报告尚未保存。请点击“保存桌面报告”，选择可写入的位置。',
    state: '结果', stage: '步骤', installation: '安装位置', launcher: '启动器', version: 'SPSS 版本', detail: '诊断',
    next: '下一步', nextSuccess: '打开 .sps 文件，点击“运行全部”。',
    WINDOWS_DISCOVERY_PARTIAL: '部分 Windows 安装线索无法读取；仍会检查注册表和常见目录，可用“选择 SPSS 文件夹”补充。',
    WINDOWS_VERSION_UNKNOWN: '无法读取程序补丁版本；以实际运行测试判断可用性。',
    importFailed: 'IBM Python 集成无法导入。请使用匹配版本的官方 SPSS 安装程序修复组件。',
    licenseFailed: 'SPSS 启动返回授权相关错误。请检查许可证或学校的许可证服务器。',
    launchFailed: 'Windows 无法运行 IBM launcher。请检查文件是否存在，并确认使用 1.4.0 插件。',
    timeout: '等待 SPSS 超时。请检查授权、启动拦截或磁盘状况；必要时增加启动等待时间。',
    rollback: '恢复旧配置时遇到问题。请保留报告并检查 SPSS Studio 设置。',
    percentPath: 'SPSS 或 VS Code 扩展路径含百分号（%），IBM 批处理会再次展开它。请使用不含百分号的安装/扩展路径后重试。',
    lockUnavailable: '本机配置通道暂不可用。请关闭其他配置窗口后重试；若仍失败，请保存报告。',
  } : {
    title: 'Detect and Configure SPSS', start: 'Detect and Configure', chooseFolder: 'Choose SPSS Folder', cancel: 'Cancel', report: 'Save Desktop Report',
    introduction: 'Find local SPSS, test its calculation engine, and save working settings. No manual environment-variable editing. Tests use separate temporary data.',
    ready: 'Select Detect and Configure to begin.', discovery: 'Finding local SPSS…', save: 'Saving and verifying effective settings…',
    select: 'Multiple working SPSS installations: select one', folderTitle: 'Select the IBM SPSS Statistics installation root',
    success: 'Configuration passed. You can run .sps files.', failed: 'Configuration is incomplete.', cancelled: 'Cancelled. Setup changes were not retained.',
    busy: 'An SPSS session or startup is active. Save any data you need, run SPSS: Stop Engine manually, then retry setup.',
    untrusted: 'Trust your own folder using Workspaces: Manage Workspace Trust before running setup.',
    remote: 'Use a local Windows or Mac VS Code window. WSL, SSH, containers, and browser windows cannot use local SPSS.',
    missing: 'No complete IBM launcher and SPSS installation found. Choose the installation folder or repair SPSS and retry.',
    override: 'Workspace settings override user settings. Repair only the required SPSS Studio paths and auto-start settings?',
    repair: 'Repair and Continue', unknown: 'The cause is not confirmed. Save the report for review.', retry: 'Resolve the issue above, then retry.',
    startup: 'Verify Python integration and SPSS startup', analysis: 'Calculate with temporary data', data: 'Check variables, three rows, and mean 30', output: 'Check native HTML results', shutdown: 'Verify graceful shutdown',
    reportSaved: 'Report saved', noReport: 'Complete a detection first.', reportTitle: 'SPSS Studio Setup Report',
    reportWriteFailed: 'The desktop report was not saved. Use Save Desktop Report to choose a writable location.',
    state: 'Result', stage: 'Stage', installation: 'Installation', launcher: 'Launcher', version: 'SPSS version', detail: 'Diagnostics',
    next: 'Next', nextSuccess: 'Open an .sps file and select Run All.',
    WINDOWS_DISCOVERY_PARTIAL: 'Some Windows installation hints were unavailable. Registry/common locations are still checked; use Choose SPSS Folder if needed.',
    WINDOWS_VERSION_UNKNOWN: 'Executable patch version is unavailable; actual runtime tests determine compatibility.',
    importFailed: 'IBM Python integration cannot be imported. Repair it with the matching official SPSS installer.',
    licenseFailed: 'SPSS reported a licensing error. Check the license or your institution’s license server.',
    launchFailed: 'Windows could not run the IBM launcher. Verify the file and use extension 1.4.0.',
    timeout: 'SPSS timed out. Check licensing, application blocking, or disk performance; increase the startup timeout if necessary.',
    rollback: 'Restoring prior settings failed. Keep this report and inspect SPSS Studio settings.',
    percentPath: 'The SPSS or VS Code extension path contains %. IBM batch CALL expands this character. Use installation/extension paths without percent signs.',
    lockUnavailable: 'The local setup channel is unavailable. Close other setup windows and retry; save the report if it persists.',
  };
}

export function setupAdvice(error: string, language: string): string {
  const s = setupStrings(language);
  if (/SETUP_ENGINE_BUSY/u.test(error)) { return s.busy; }
  if (/SETUP_LOCK_UNAVAILABLE/u.test(error)) { return s.lockUnavailable; }
  if (/SETUP_ROLLBACK_FAILED/u.test(error)) { return s.rollback; }
  if (/SETUP_CANCELLED/u.test(error)) { return s.cancelled; }
  if (/literal %/u.test(error)) { return s.percentPath; }
  if (/Unable to import|No module named|DLL load/iu.test(error)) { return s.importFailed; }
  if (/license|licen[cs]ing|许可证|授权/iu.test(error)) { return s.licenseFailed; }
  if (/not recognized|不是内部|ENOENT/iu.test(error)) { return s.launchFailed; }
  if (/timed out/iu.test(error)) { return s.timeout; }
  return s.unknown;
}
