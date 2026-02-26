# 给 pb config 增加2个命令

## 1. pb config backup
将 ~/.config/ponybunny 下除了 `credentials.json`和`vault` 以外的文件和目录打包、压缩、按照当前日期和时间来作为文件名，存储在 ~/.config/ponybunny/backup 目录下。
用户可以输入passcode用来给backup文件加密。

## 2. pb config restore
用户输入命令后，自动从 ~/.config/ponybunny/backup 文件夹里读取备份文件，按照从新到旧的顺序排序列出，用户通过上下键选择，回车键确认。
如果之前的backup文件设置了passcode，则需要提示用户输入passcode。
再加一层确认over write的提示。 最后将解密并解压后的配置文件覆盖掉到当前用户的 ~/.config/ponybunny 下面。

