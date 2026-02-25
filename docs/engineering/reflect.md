# scheduler 状态反射机制

## 为什么做这个功能
当前scheduler、gateway、TUI/WebUI等是完全解耦的。如果要实现human-in-loop，那么就需要建立一个双向通信和控制的链路，将用户的操作通过gateway与scheduler的内部联系起来。

## 需要做哪些功能

1. scheduler启动时加载的各项资源，例如：llm provider，model，skills，mcp，agent 等，可以让TUI或webui通过gateway来查询获取到，接下来用户可以在TUI或webui等交互界面里实现选择Agent、选择mcp、选择llm model等运行时的human-in-loop的实时调整操作。
2. scheduler在执行内部任务的时候，需要在每个子任务的开始、进行中、结束、成功、失败等状态改变时触发事件，并由统一的事件监听器获取后通过gateway推送给TUI或webui，同时将事件数据入库保存（后续用户查看任务的时候就有数据来查看了）。
3. 当环境变量 PONY_BUNNY_DEBUG=1 时，在以上的正常业务通知的事件和数据的基础上增加更详细的debug事件，并且启动一个debug事件监听器来收集这些事件然后发布到debug server（如果监测到debug server已经启动并且能访问的情况下），根据debug的配置来决定是直接在console输出信息、写入log文件或写入debug数据库。

## 优先级
1和2是高优先级，因为这是系统功能方面的需求。
3的优先级分为2部分，第一部分是可以收集debug事件并能在console打印或写入到文件，这个高优先级；第二部分是配合debug server做更加实时的监控，由于debug server还没有完全能工作，因此这个需求作为低优先级最后再个debug server一起做开发实现。
