为了避免将来接入更多provider和model之后导致的配置文件语意不清和混淆，现在对llm-config的结构做以下的调整，同时需要调整的还有使用llm-config的所有相关的代码。

1. providers 里预设以下名字：
    - anthropic (原anthropic-direct), openai（原openai-direct）, aws-bedrock, azure-openai, google-ai-studio, google-vertex-ai, openai-codex
2. providers 增加一个 type 字段，可选项为 api 和 oauth。 除了 openai-codex 的type是oauth以外，其他的都默认 api。
3. models 的结构更改为 <provider>.<model> 的配置结构，将现在model里面的 providers 去掉。 系统代码加载的时候直接根据指定的 provider.model 的值了来找配置信息。 在找到model的配置后，再通过provider到credentials里提取apikey或access token等。
4. openai-compatible 作为给用户自定义provider的功能存在，用户可以通过直接更改配置文件或通过 pb auth config 里的 new provider 选项来创建自己的provider。
5. tiers和workloads里配置的模型名字的内容不动，但语意改为根上面的设计保持一致。
6. 要同时修改schema和pb init的命令。 并且调整 llm-config.example.json 和 credentials.example.json 的内容。
