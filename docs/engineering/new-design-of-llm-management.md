1. 给 pb auth 增加一个 add-provider 命令，实现通过向导的方式让用户添加 provider, 设置type，protocol等关键信息.
2. pb auth config 里，列出用户添加的 provider， 针对用户添加的 provider 提供“删除”的功能。 系统预设的不要提供“删除”功能。 如果 protocal 是 openai，则再提供一个fetch model的选项，通过调用 /v1/models 的endpoint来获取用户自定义的provider提供的可用模型，列出来之后，用户可以通过上下键多选的方式将模型名称加入到 llm-config 的 models配置段里。
