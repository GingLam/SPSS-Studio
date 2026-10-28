# SPSS Studio 1.4.0：Windows 测试步骤

此安装包已完成本机自动测试与 Mac SPSS 验证；Windows 的 CMD 和真实 SPSS 验收需要在 Windows 电脑上执行。请勿把“待验收”理解为 Windows 已验证成功。

## 1. 安装

1. 确认电脑已安装并授权 IBM SPSS Statistics。
2. 在 VS Code 中按 `Ctrl+Shift+X`，点击扩展视图右上角 `…`，选择“从 VSIX 安装”。
3. 选择 `spss-studio-1.4.0.vsix`，根据提示重新加载窗口。
4. 确认扩展详情页版本为 1.4.0。
5. 使用本地 VS Code 窗口；左下角不能显示 WSL、SSH 或 Dev Container。
6. 对自己创建的测试文件夹启用工作区信任。

## 2. 一键配置

1. 在“快速上手”页面点击 **一键检测并配置 SPSS**。
2. 如果没有显示快速上手，按 `Ctrl+Shift+P`，搜索 **SPSS：检测并配置**，进入后点击 **一键检测并配置**。
3. 等待查找、启动、计算、数据、HTML 输出和关闭验证。首次启动可能较慢。
4. 找到多套可用 SPSS 时，选择本次要使用的一套。
5. 提示工作区设置冲突时，核对后点击“修复并继续”。
6. 成功应显示“配置成功，可以运行 .sps 文件”。

不需要手工设置 PATH、PYTHONHOME 或 PYTHONPATH。不需要另装 Python。

## 3. 自动检测失败时

- 未找到 SPSS：点击 **选择 SPSS 文件夹**，选择实际安装目录，例如 `D:\SPSS` 或 `C:\Program Files\IBM\SPSS Statistics\27`。
- 已有会话：保存需要保留的数据，执行 **SPSS：停止引擎**，然后重新配置。向导不会自动关闭正在使用的数据集。
- Python 或许可证错误：按页面提示修复对应组件或授权，再运行相同按钮。
- 取消：应停止测试并恢复本次已修改的配置；恢复失败必须显示警告，不能报告成功。

不要创建或修改 IBM 安装目录中的批处理文件，不要将 `python.exe` 或学生自建的 `spss_bridge.bat` 填入 launcher 设置。

少见的限制：SPSS 和 VS Code 扩展路径不能包含字面百分号 `%`，以免 IBM 批处理的 `CALL` 将其展开成其他环境变量；向导会明确报告这种路径。

## 4. 检查报告

Windows 检测完成后应在真实桌面（兼容 OneDrive 桌面）保存：

```text
SPSS-Studio-Setup-日期时间.txt
```

如果桌面不能写入，点击 **保存桌面报告**，按对话框选择其他位置。报告应包含最终结果、安装路径、通过的步骤和下一步，不应包含 AI Key、Chat 对话或学生数据。

失败时请将该 TXT 报告发送给开发者；必要时同时提供 VS Code“查看 → 输出 → SPSS”中的 Setup/Bridge 日志。

## 5. 正常运行验证

新建并保存 `test.sps`，粘贴：

```spss
DATA LIST FREE /id age.
BEGIN DATA
1 20
2 30
3 40
END DATA.
DATASET NAME StudentTest.
DESCRIPTIVES VARIABLES=age.
```

点击 **运行全部**，确认：

- 输出中出现描述统计表，age 的 N 为 3，均值为 30。
- 变量页面有 id、age；数据页面有三行。
- 编辑器选中一条命令可以“运行”。
- 停止、重启引擎后仍能再次运行。

## 6. 建议覆盖的电脑

- SPSS 默认安装目录和 `D:\SPSS` 等自定义目录。
- 路径含空格、中文用户名或中文目录。
- 安装和未安装 Anaconda 的电脑。
- 曾配置错误路径的电脑。
- 多套 SPSS 并存、不同 VS Code Profile。
- 取消检测、重新检测及关闭/重新加载向导。

每份反馈请附 Windows 版本、SPSS 完整版本及配置报告。开发者在 Mac 上不会为此安装 Windows 虚拟机或大型额外运行环境。
