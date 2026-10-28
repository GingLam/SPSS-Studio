* SPSS Studio 示例.
* 1. 选中下面的 GET FILE 命令，点击“运行”，或按 Ctrl+Enter（Mac 为 Cmd+Enter）.
* “一键加载示例”按钮会自动填写 SAV 路径；点击“全部运行”可执行所有章节.
* 再次读取此文件可恢复最初的模拟观测数据.
GET FILE="spss-studio-example.sav".

* 2. 在 Studio 中打开“变量”和“数据”；双击变量名可将其插入语法编辑位置.
VARIABLE LABELS
 id "个案编号"
 age "年龄（岁）"
 gender "模拟性别组别"
 edu "受教育年限"
 income "模拟月收入"
 hours "每周工作时长（小时）".
VALUE LABELS gender 0 "组别 A" 1 "组别 B".
VARIABLE LEVEL id gender (NOMINAL) age edu income hours (SCALE).
FORMATS id (F3.0) age (F2.0) gender (F1.0) edu (F2.0) income (F8.2) hours (F4.1).

* 3. 查看变量字典、类别分布和描述统计.
CODEBOOK  age gender edu income hours.
FREQUENCIES VARIABLES=gender.
DESCRIPTIVES VARIABLES=age edu income hours
 /STATISTICS=MEAN STDDEV MIN MAX.

* 4. 绘制组别条形图，以及教育与收入的散点图，在“输出”中查看.
GRAPH /BAR(SIMPLE)=COUNT BY gender.
GRAPH /SCATTERPLOT(BIVAR)=edu WITH income.

* 5. 用独立样本 t 检验比较两个模拟组别的收入.
* 真实研究应先核查测量层次、分布、各组样本量和检验假设.
T-TEST GROUPS=gender(0 1)
 /VARIABLES=income
 /CRITERIA=CI(.95).

* 6. 演示线性回归；模拟数据的关联不能作为真实因果证据.
REGRESSION
 /DEPENDENT income
 /METHOD=ENTER age gender edu hours.

* 7. 点击“输出”中的“解释”，或选中语法后右键“在对话中解释”.
* 在“变量”中勾选变量后点击“探索”；对话功能需要配置自己的模型 API.
* 对话代码块提供“复制、插入、运行”，请先审阅生成的代码再执行.
* “输出”中的“清空”会丢弃本 Studio 引擎的全部数据及未保存修改.
* 原始文件、输出历史和对话会保留；仅打开示例不会自动运行命令.
